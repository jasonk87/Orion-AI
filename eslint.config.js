'use strict';

// Deliberately narrow: correctness rules only, no style opinions.
//
// The point of linting a codebase this size is to catch the things that are invisible in review
// — an unused variable that marks dead code, a reference to something that does not exist, a
// duplicate object key that silently drops a value, code after a return. Style rules would bury
// those under thousands of formatting complaints and the whole thing would get switched off.
//
// The browser/Node split matters here: renderer.js and agent.js load as plain <script> tags in
// ONE shared browser scope with no Node globals, while main.js and lib/* are Node. Linting them
// under the wrong environment produces false "undefined variable" reports and hides real ones.

const BROWSER_GLOBALS = {
  window: 'writable', document: 'readonly', navigator: 'readonly', location: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', fetch: 'readonly', console: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', queueMicrotask: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', File: 'readonly',
  FileReader: 'readonly', FormData: 'readonly', Image: 'readonly', Audio: 'readonly',
  AbortController: 'readonly', WebSocket: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
  MutationObserver: 'readonly', IntersectionObserver: 'readonly', ResizeObserver: 'readonly',
  getComputedStyle: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  structuredClone: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  btoa: 'readonly', atob: 'readonly', crypto: 'readonly', performance: 'readonly',
  CSS: 'readonly',
  // Vendored libraries loaded by <script> before the app scripts.
  marked: 'readonly', Prism: 'readonly', QRCode: 'readonly',
  // Node-ish globals the app scripts guard with `typeof x !== 'undefined'` for test loading.
  module: 'writable', require: 'readonly', process: 'readonly', globalThis: 'readonly',

  // Cross-script bindings. renderer.js and agent.js are separate <script> tags sharing ONE
  // global lexical scope, so a top-level `let` in one is visible to the other. That coupling is
  // real and load-order dependent — it is declared here so the linter reports genuine typos
  // instead of drowning them in known cross-file references.
  // renderer.js -> agent.js:
  conversations: 'writable', activeConversationId: 'writable', appMode: 'writable',
  // agent.js -> renderer.js:
  callUtilityModel: 'readonly'
};

const NODE_GLOBALS = {
  require: 'readonly', module: 'writable', exports: 'writable', process: 'readonly',
  console: 'readonly', __dirname: 'readonly', __filename: 'readonly', Buffer: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  setImmediate: 'readonly', clearImmediate: 'readonly', queueMicrotask: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly',
  fetch: 'readonly', AbortController: 'readonly', WebSocket: 'readonly', structuredClone: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', global: 'writable', globalThis: 'readonly',
  performance: 'readonly',
  // Tests install a browser-ish surface on globalThis before requiring the app scripts.
  window: 'writable', document: 'writable'
};

const CORRECTNESS_RULES = {
  // Dead code and typos — the two things worth a linter on a 12k-line file.
  'no-unused-vars': ['warn', {
    args: 'none',
    caughtErrors: 'none',
    varsIgnorePattern: '^_',
    ignoreRestSiblings: true
  }],
  'no-undef': 'error',
  'no-unreachable': 'error',

  // Silent data loss.
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-dupe-else-if': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',

  // Genuine mistakes, not preferences.
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-class-assign': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-fallthrough': 'error',
  'no-sparse-arrays': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-finally': 'error',
  'no-compare-neg-zero': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-async-promise-executor': 'error',
  'require-atomic-updates': 'off'
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'standalone-workspaces/**',
      '.orion/**',
      'skills/**',
      'assets/**'
    ]
  },
  {
    // Browser scope: everything index.html loads as a <script>.
    files: [
      'renderer.js', 'agent.js', 'operational-context.js', 'workspace-resolution.js',
      'orchestration-contracts.js', 'dispatch-intent.js', 'semantic-intent-router.js',
      'reasoning-policy.js', 'task-orchestration.js', 'supervisor-orchestration.js',
      'prompt-submission.js'
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: BROWSER_GLOBALS
    },
    rules: CORRECTNESS_RULES
  },
  {
    // Node scope: main process, lib modules, tooling and tests.
    files: ['main.js', 'preload.js', 'safety.js', 'test-runner.js', 'lib/**/*.js', 'scripts/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS
    },
    rules: CORRECTNESS_RULES
  }
];
