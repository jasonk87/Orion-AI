const test = require('tape');
const fs = require('fs');
const path = require('path');

const styles = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

test('desktop uses the unified Orion command-center design system', (t) => {
  t.ok(styles.includes('--bg-primary: #090b12'), 'uses graphite Orion background');
  t.ok(styles.includes('--accent-color: #8273f4'), 'uses one violet-blue brand accent');
  t.ok(styles.includes('--success-color: #46d59b'), 'reserves emerald for success');
  t.ok(styles.includes('Segoe UI Variable'), 'uses a production system typography stack');
  t.ok(styles.includes('Orion command-center refinement'), 'loads the final desktop refinement layer');
  t.end();
});

test('desktop polish includes accessible focus and reduced-motion behavior', (t) => {
  t.ok(styles.includes('button:focus-visible'), 'provides keyboard focus rings');
  t.ok(styles.includes('@media (prefers-reduced-motion: reduce)'), 'respects reduced-motion preference');
  t.ok(styles.includes('@keyframes message-enter'), 'animates message entry');
  t.ok(styles.includes('@keyframes status-breathe'), 'animates live status intentionally');
  t.ok(html.includes('id="workspace-label" role="button" tabindex="0"'), 'workspace picker is keyboard focusable');
  t.ok(html.includes('id="operational-context-panel" aria-live="polite"'), 'Mission Control updates are announced');
  t.notOk(html.includes('id="nav-tasks"'), 'does not expose an unfinished Scheduled Tasks control');
  t.notOk(html.includes('id="btn-voice"'), 'does not expose an inert microphone control');
  t.notOk(html.includes('class="quick-tips"'), 'keeps the welcome state focused on the agent');
  t.ok(styles.includes('#btn-change-workspace,\n#btn-sync-files { display: none; }'), 'hides redundant workspace chrome');
  t.ok(html.includes('aria-label="Minimize window"'), 'window controls have accessible names');
  t.ok(fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').includes("el.chatInput.value += `${needsSpace ? ' ' : ''}@`;"), 'file mention button performs a real action');
  t.end();
});

test('phone companion finishes with the same dark theme and complete mission hierarchy', (t) => {
  const unifiedThemeIndex = main.indexOf('Unified Orion dark companion theme');
  const legacyLightIndex = main.indexOf('Codex-inspired mobile shell, Orion palette');
  t.ok(unifiedThemeIndex > legacyLightIndex, 'unified dark theme wins the cascade');
  t.ok(main.slice(unifiedThemeIndex).includes('color-scheme: dark'), 'phone declares dark controls');
  t.ok(main.slice(unifiedThemeIndex).includes('#mission-context-card { grid-area: mission; }'), 'Mission Control has an explicit mobile layout area');
  t.ok(main.slice(unifiedThemeIndex).includes('@media (prefers-reduced-motion: reduce)'), 'phone respects reduced motion');
  t.ok(main.includes('button.send-button::before { content: "\\\\2191"'), 'phone send icon is encoding-safe');
  t.end();
});
