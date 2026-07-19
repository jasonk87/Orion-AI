'use strict';

const { spawn } = require('child_process');

const MAX_STDOUT_CHARS = 16000;
const MAX_STDERR_CHARS = 4000;
const SAFE_PRAGMAS = new Set([
  'application_id', 'collation_list', 'compile_options', 'database_list', 'encoding',
  'foreign_key_list', 'freelist_count', 'function_list', 'index_info', 'index_list',
  'index_xinfo', 'integrity_check', 'module_list', 'page_count', 'page_size',
  'pragma_list', 'quick_check', 'schema_version', 'table_info', 'table_list',
  'table_xinfo', 'user_version'
]);
const MUTATING_SQL = /\b(INSERT|UPDATE|DELETE|UPSERT|REPLACE|MERGE|DROP|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|VACUUM|REINDEX|ANALYZE|GRANT|REVOKE|CALL|DO|COPY|LOCK|UNLOCK|SET|RESET|REFRESH|CLUSTER|COMMENT)\b/i;

function maskSql(sql) {
  let output = '';
  let state = 'normal';
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    const next = sql[index + 1];
    if (state === 'line') {
      if (char === '\n') { state = 'normal'; output += '\n'; } else output += ' ';
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') { output += '  '; index++; state = 'normal'; } else output += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (state === 'single') {
      if (char === "'" && next === "'") { output += '  '; index++; }
      else if (char === "'") { output += ' '; state = 'normal'; }
      else output += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (state === 'double') {
      if (char === '"' && next === '"') { output += '  '; index++; }
      else if (char === '"') { output += ' '; state = 'normal'; }
      else output += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (char === '-' && next === '-') { output += '  '; index++; state = 'line'; continue; }
    if (char === '/' && next === '*') { output += '  '; index++; state = 'block'; continue; }
    if (char === "'") { output += ' '; state = 'single'; continue; }
    if (char === '"') { output += ' '; state = 'double'; continue; }
    output += char;
  }
  return output;
}

function validateReadOnlyQuery(query, dbType = 'sqlite') {
  const sql = String(query || '').trim();
  if (!sql) return { safe: false, error: 'Query is required.' };
  if (sql.includes('\0')) return { safe: false, error: 'SQL contains an invalid null byte.' };
  const masked = maskSql(sql).trim();
  const withoutTrailingSemicolon = masked.replace(/;\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) {
    return { safe: false, error: 'Only one read-only SQL statement is allowed per call.' };
  }
  if (MUTATING_SQL.test(withoutTrailingSemicolon)) {
    return { safe: false, error: 'db_query is read-only; mutating SQL keywords are blocked.' };
  }
  const first = (withoutTrailingSemicolon.match(/^([A-Za-z]+)/) || [])[1];
  if (!first) return { safe: false, error: 'SQL must begin with a supported read-only statement.' };
  const keyword = first.toUpperCase();
  if (keyword === 'PRAGMA') {
    if (dbType !== 'sqlite') return { safe: false, error: 'PRAGMA is only supported for SQLite.' };
    if (/=/.test(withoutTrailingSemicolon)) return { safe: false, error: 'Writable PRAGMA assignments are blocked.' };
    const pragmaName = (withoutTrailingSemicolon.match(/^PRAGMA\s+(?:[A-Za-z_][\w]*\.)?([A-Za-z_][\w]*)/i) || [])[1];
    if (!pragmaName || !SAFE_PRAGMAS.has(pragmaName.toLowerCase())) {
      return { safe: false, error: `PRAGMA ${pragmaName || ''} is not on the read-only metadata allowlist.`.trim() };
    }
    return { safe: true, query: sql };
  }
  if (!['SELECT', 'WITH', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'DESC', 'VALUES'].includes(keyword)) {
    return { safe: false, error: `Statement '${keyword}' is not allowed by the read-only database tool.` };
  }
  return { safe: true, query: sql };
}

function connectionEnvironment(connectionString, dbType) {
  let parsed;
  try { parsed = new URL(connectionString); } catch (_) { throw new Error('Invalid database connection URL.'); }
  const protocol = parsed.protocol.replace(':', '').toLowerCase();
  if (dbType === 'postgres' && !['postgres', 'postgresql'].includes(protocol)) throw new Error('Postgres requires a postgres:// or postgresql:// URL.');
  if (dbType === 'mysql' && protocol !== 'mysql') throw new Error('MySQL requires a mysql:// URL.');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (dbType === 'postgres') {
    return {
      executable: 'psql',
      args: ['--no-psqlrc', '--csv', '--tuples-only', '--set=ON_ERROR_STOP=1'],
      env: {
        PGHOST: parsed.hostname,
        PGPORT: parsed.port || '5432',
        PGUSER: decodeURIComponent(parsed.username),
        PGPASSWORD: decodeURIComponent(parsed.password),
        PGDATABASE: database,
        ...(parsed.searchParams.get('sslmode') ? { PGSSLMODE: parsed.searchParams.get('sslmode') } : {})
      }
    };
  }
  return {
    executable: 'mysql',
    args: ['--batch', '--raw', '--host', parsed.hostname, '--port', parsed.port || '3306', '--user', decodeURIComponent(parsed.username), '--database', database],
    env: { MYSQL_PWD: decodeURIComponent(parsed.password) }
  };
}

function buildDatabaseInvocation({ query, dbPath, connectionString, dbType }) {
  const inferredType = dbPath
    ? 'sqlite'
    : (/^postgres(?:ql)?:\/\//i.test(String(connectionString || '')) ? 'postgres'
      : (/^mysql:\/\//i.test(String(connectionString || '')) ? 'mysql' : ''));
  const normalizedType = String(dbType || inferredType).toLowerCase().replace('postgresql', 'postgres');
  const validation = validateReadOnlyQuery(query, normalizedType);
  if (!validation.safe) throw new Error(validation.error);
  if (normalizedType === 'sqlite') {
    if (!dbPath) throw new Error("SQLite requires 'dbPath'.");
    return {
      dbType: normalizedType,
      executable: 'sqlite3',
      args: ['-readonly', String(dbPath), '.mode json', '.headers on', validation.query],
      env: {}
    };
  }
  if (!['postgres', 'mysql'].includes(normalizedType)) throw new Error("dbType must be 'sqlite', 'postgres', or 'mysql'.");
  if (!connectionString) throw new Error(`${normalizedType === 'postgres' ? 'Postgres' : 'MySQL'} requires 'connectionString'.`);
  const invocation = connectionEnvironment(connectionString, normalizedType);
  const wrappedQuery = normalizedType === 'postgres'
    ? `BEGIN READ ONLY; ${validation.query.replace(/;\s*$/, '')}; COMMIT;`
    : `START TRANSACTION READ ONLY; ${validation.query.replace(/;\s*$/, '')}; ROLLBACK;`;
  invocation.args.push(normalizedType === 'postgres' ? '-c' : '-e', wrappedQuery);
  return { dbType: normalizedType, ...invocation };
}

function executeDatabaseQuery(payload = {}) {
  let invocation;
  try { invocation = buildDatabaseInvocation(payload); } catch (error) { return Promise.resolve({ success: false, error: error.message }); }
  const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs) || 30000, 1000), 120000);
  return new Promise(resolve => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: payload.workspacePath || undefined,
      env: { ...process.env, ...invocation.env },
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish({ success: false, dbType: invocation.dbType, error: `Database query timed out after ${timeoutMs}ms.`, timedOut: true });
    }, timeoutMs);
    child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-MAX_STDOUT_CHARS); });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-MAX_STDERR_CHARS); });
    child.on('error', error => finish({ success: false, dbType: invocation.dbType, error: error.message }));
    child.on('close', code => {
      if (settled) return;
      let rows = null;
      if (invocation.dbType === 'sqlite' && stdout.trim().startsWith('[')) {
        try { rows = JSON.parse(stdout.trim()); } catch (_) {}
      }
      finish({
        success: code === 0,
        dbType: invocation.dbType,
        exitCode: code,
        ...(rows ? { rows, rowCount: rows.length } : { output: stdout }),
        ...(stderr ? { error: stderr } : {})
      });
    });
  });
}

function registerHandlers(ipcMain) {
  ipcMain.handle('orion:db-query', (event, payload) => executeDatabaseQuery(payload));
}

module.exports = {
  registerHandlers,
  validateReadOnlyQuery,
  buildDatabaseInvocation,
  executeDatabaseQuery
};
