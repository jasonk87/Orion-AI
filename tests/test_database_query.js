const test = require('tape');
const { validateReadOnlyQuery, buildDatabaseInvocation } = require('../lib/ipc-database');

test('db_query allows one read-only statement and safe SQLite metadata pragmas', (t) => {
  t.equal(validateReadOnlyQuery('SELECT * FROM users LIMIT 5', 'sqlite').safe, true, 'SELECT is allowed');
  t.equal(validateReadOnlyQuery('WITH rows AS (SELECT 1 AS id) SELECT * FROM rows', 'postgres').safe, true, 'read-only CTE is allowed');
  t.equal(validateReadOnlyQuery('PRAGMA table_info(users)', 'sqlite').safe, true, 'safe metadata PRAGMA is allowed');
  t.end();
});

test('db_query blocks mutations, writable pragmas, side-effect CTEs, and stacked statements', (t) => {
  const blocked = [
    'DROP TABLE users',
    'DELETE FROM users',
    'UPDATE users SET admin = 1',
    'SELECT 1; DELETE FROM users',
    'WITH removed AS (DELETE FROM users RETURNING *) SELECT * FROM removed',
    'PRAGMA journal_mode=WAL',
    'PRAGMA wal_checkpoint(TRUNCATE)'
  ];
  for (const query of blocked) t.equal(validateReadOnlyQuery(query, 'sqlite').safe, false, `blocked: ${query}`);
  t.end();
});

test('database invocations keep connection credentials out of process arguments', (t) => {
  const password = 'private-password';
  const postgres = buildDatabaseInvocation({
    dbType: 'postgres',
    connectionString: `postgresql://reader:${password}@db.example.com:5432/app`,
    query: 'SELECT 1'
  });
  const mysql = buildDatabaseInvocation({
    dbType: 'mysql',
    connectionString: `mysql://reader:${password}@db.example.com:3306/app`,
    query: 'SELECT 1'
  });
  const sqlite = buildDatabaseInvocation({ dbType: 'sqlite', dbPath: 'C:\\data\\app.db', query: 'SELECT 1' });

  t.notOk(postgres.args.join(' ').includes(password), 'Postgres password is not present in argv');
  t.equal(postgres.env.PGPASSWORD, password, 'Postgres password is supplied through the child environment');
  t.ok(postgres.args.join(' ').includes('BEGIN READ ONLY'), 'Postgres query is wrapped in a read-only transaction');
  t.notOk(mysql.args.join(' ').includes(password), 'MySQL password is not present in argv');
  t.equal(mysql.env.MYSQL_PWD, password, 'MySQL password is supplied through the child environment');
  t.ok(mysql.args.join(' ').includes('START TRANSACTION READ ONLY'), 'MySQL query is wrapped in a read-only transaction');
  t.ok(sqlite.args.includes('-readonly'), 'SQLite is opened in explicit read-only mode');
  t.end();
});
