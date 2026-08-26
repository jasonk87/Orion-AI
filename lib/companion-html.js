'use strict';

const specialistRegistry = require('../specialist-registry');

const COMPANION_CLIENT_BUILD = 'conversation-preview-and-durable-counts-v36';
const COMPANION_SPECIALISTS = specialistRegistry.list().map(definition => ({
  role: definition.role,
  label: definition.label,
  canEditWorkspace: definition.canEditWorkspace,
  canControlDesktop: definition.canControlDesktop
}));

function companionSpecialistSubtitle(definition) {
  if (definition.canControlDesktop) return 'Desktop &amp; Browser';
  if (definition.canEditWorkspace) return 'Projects';
  return 'Research &amp; Synthesis';
}

function companionHtml(machineName) {
  const specialistDrawerButtons = COMPANION_SPECIALISTS.map(definition => `
        <button class="drawer-nav-btn" data-drawer-destination="${definition.role}" type="button">
          <span>${definition.label}</span><span class="drawer-nav-sub">${companionSpecialistSubtitle(definition)}</span>
        </button>`).join('');
  const specialistModeButtons = COMPANION_SPECIALISTS.map(definition => `
        <button type="button" class="mode-toggle-btn" id="mode-toggle-${definition.role}" data-mode="${definition.role}">${definition.label}</button>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
  <title>Orion</title>
  <meta name="theme-color" content="#07070a">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Orion AI">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/icon-192.png">
  <link rel="icon" href="/icon.svg">
  <script src="/marked.min.js"></script>
  <script src="/task-orchestration.js"></script>
  <!-- Markdown-rendering cleanup: same prismjs file set index.html loads for desktop (core +
       language components + the tomorrow theme), served from the companion HTTP server's
       /prism.js, /prism-components/*, /prism-theme.css routes (lib/ipc-server.js) instead of a
       node_modules-relative path, since this HTML is served over HTTP rather than loaded from
       disk. Phone code blocks previously rendered as plain monospace text with no highlighting;
       Prism.highlightAllUnder() is now called after markdown render, mirroring renderer.js. -->
  <link rel="stylesheet" href="/prism-theme.css">
  <script src="/prism.js"></script>
  <script src="/prism-components/prism-javascript.min.js"></script>
  <script src="/prism-components/prism-css.min.js"></script>
  <script src="/prism-components/prism-json.min.js"></script>
  <style>
    /* Single consolidated :root — DO NOT add more :root blocks below */
    :root {
      color-scheme: dark;
      --bg: #090b12;
      --surface: #111827;
      --surface2: #151c2b;
      --line: rgba(148,163,184,0.16);
      --text: #f7f8ff;
      --muted: #98a2b3;
      --accent: #8273f4;
      --accent-strong: #6f5ef0;
      --success: #46d59b;
      --warning: #f5c451;
      --danger: #ff7b7b;
      --gradient-mark: linear-gradient(135deg, #8273f4, #4f8dff);
      font-family: 'Segoe UI Variable', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    /* overflow:hidden only on .app-root — keeping it on html/body breaks Android keyboard reflow */
    html, body { height: 100%; background: var(--bg); color: var(--text); }

    /* Markdown Styling */
    .message-answer table { border-collapse: collapse; width: 100%; margin: 10px 0; overflow-x: auto; display: block; }
    .message-answer th, .message-answer td { border: 1px solid var(--line); padding: 7px 9px; text-align: left; }
    .message-answer th { background: var(--surface2); font-weight: 700; }
    /* Zebra striping so a comparison table (the shape a research write-up's multi-source
       comparison naturally takes) stays scannable row-to-row instead of running together at this
       small a font size. */
    .message-answer tbody tr:nth-child(even) td { background: rgba(255,255,255,0.03); }
    .message-answer pre { background: var(--surface); padding: 8px; border-radius: 6px; overflow-x: auto; margin: 8px 0; border: 1px solid var(--line); }
    .message-answer code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.85em; background: rgba(255,255,255,0.05); padding: 2px 4px; border-radius: 4px; }
    .message-answer pre code { background: transparent; padding: 0; }
    .message-answer blockquote { border-left: 3px solid var(--line); padding-left: 12px; margin: 8px 0; color: var(--muted); }
    .message-answer p { margin-bottom: 8px; }
    .message-answer p:last-child { margin-bottom: 0; }
    .message-answer ul, .message-answer ol { margin-left: 24px; margin-bottom: 8px; }
    
    /* ── App root ─────────────────────────────────── */
    .app-root {
      height: 100%;
      height: 100dvh;
      /* Set by the visualViewport listener below so the keyboard can't cover
         the composer on iOS/WebView, where 100dvh doesn't shrink on its own. */
      height: var(--app-vvh, 100dvh);
      position: relative;
      overflow: hidden;
      background: var(--bg);
    }

    /* ── Screens ──────────────────────────────────── */
    .screen {
      position: absolute;
      inset: 0;
      display: none;
      flex-direction: column;
      overflow: hidden;
    }
    .screen.active { display: flex; pointer-events: auto; }

    /* ── Shared atoms ─────────────────────────────── */
    .mark {
      width: 30px; height: 30px; border-radius: 9px;
      display: grid; place-items: center;
      background: linear-gradient(145deg, #60a5fa, #2563eb 60%, #111827);
      box-shadow: 0 6px 18px rgba(37,99,235,0.3);
      font-weight: 900; font-size: 0.85rem; color: #fff; flex: 0 0 auto;
    }
    .brand-name { font-size: 1rem; font-weight: 800; color: var(--text); letter-spacing: -0.01em; }
    .back-btn {
      width: 36px; height: 36px; border-radius: 50%;
      border: 1px solid var(--line); background: rgba(255,255,255,0.05);
      color: var(--text); font-size: 1.1rem; cursor: pointer; font-family: inherit;
      display: grid; place-items: center; flex: 0 0 auto;
      transition: background 0.15s;
    }
    .back-btn:hover { background: rgba(255,255,255,0.1); }
    .status-pill {
      padding: 4px 10px; border-radius: 999px;
      border: 1px solid var(--line); background: rgba(17,17,23,0.8);
      color: var(--muted); font-size: 0.68rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.04em;
      transition: color 0.2s, border-color 0.2s, background 0.2s;
    }
    .status-pill.running { color: #6ee7b7; border-color: rgba(16,185,129,0.35); background: rgba(16,185,129,0.1); }
    .status-pill.operator-active { color: #c4b5fd; border-color: rgba(139,92,246,0.42); background: rgba(109,40,217,0.14); }
    .status-pill.connecting { color: #93c5fd; border-color: rgba(96,165,250,0.3); background: rgba(59,130,246,0.09); }
    .app-menu-btn {
      width: 36px; height: 36px; border-radius: 10px;
      border: 1px solid var(--line); background: rgba(255,255,255,0.05);
      color: var(--text); font-size: 1rem; cursor: pointer; font-family: inherit;
      display: grid; place-items: center; flex: 0 0 auto;
      transition: background 0.15s, border-color 0.15s;
    }
    .app-menu-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(130,115,244,0.35); }
    .header-leading { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .drawer-overlay {
      position: fixed; inset: 0; z-index: 70;
      display: flex; align-items: stretch; justify-content: flex-start;
      background: rgba(0,0,0,0.58); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.18s ease, visibility 0.18s ease;
    }
    .drawer-overlay.open { opacity: 1; visibility: visible; pointer-events: auto; }
    .app-drawer {
      width: min(82vw, 310px); height: 100%; padding: calc(18px + env(safe-area-inset-top)) 14px calc(18px + env(safe-area-inset-bottom));
      background: rgba(12,16,27,0.98); border-right: 1px solid var(--line);
      box-shadow: 24px 0 60px rgba(0,0,0,0.46);
      transform: translateX(-100%); transition: transform 0.22s ease;
      display: flex; flex-direction: column; gap: 16px;
    }
    .drawer-overlay.open .app-drawer { transform: translateX(0); }
    .drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .drawer-title { font-size: 0.95rem; font-weight: 800; color: var(--text); }
    .drawer-close { width: 32px; height: 32px; border-radius: 9px; border: 1px solid var(--line); background: rgba(255,255,255,0.05); color: var(--muted); font-size: 1rem; font-family: inherit; cursor: pointer; }
    .drawer-nav { display: flex; flex-direction: column; gap: 6px; }
    .drawer-nav-btn {
      width: 100%; min-height: 44px; border-radius: 10px; border: 1px solid transparent;
      background: transparent; color: var(--text); font-family: inherit; font-size: 0.9rem; font-weight: 700;
      display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 12px; cursor: pointer;
      text-align: left;
    }
    .drawer-nav-btn.active { background: rgba(130,115,244,0.12); border-color: rgba(130,115,244,0.26); color: #c4b5fd; }
    .drawer-nav-btn .drawer-nav-sub { color: var(--muted); font-size: 0.72rem; font-weight: 600; }
    .drawer-meta { margin-top: auto; color: var(--muted); font-size: 0.72rem; line-height: 1.4; }
    .chip {
      flex: 0 0 auto; padding: 5px 11px; border-radius: 999px;
      border: 1px solid var(--line); background: var(--surface);
      color: var(--text); font-size: 0.75rem; font-weight: 600;
      cursor: pointer; white-space: nowrap; font-family: inherit;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
    }
    .chip:active { transform: scale(0.96); opacity: 0.8; }
    .chip:hover { border-color: rgba(96,165,250,0.3); background: rgba(96,165,250,0.06); }
    .install-tip {
      display: none; padding: 8px 14px; font-size: 0.72rem; line-height: 1.4;
      color: #bfdbfe; background: rgba(37,99,235,0.08);
      border-top: 1px dashed rgba(96,165,250,0.2);
    }
    .install-tip.visible { display: block; }
    button { touch-action: manipulation; }
    button:active { transform: scale(0.97); }
    button:disabled { opacity: 0.5; cursor: wait; }

    /* ═══════════════════════════════════════════════
       HOME SCREEN
    ═══════════════════════════════════════════════ */
    #screen-home {
      background: radial-gradient(circle at 50% -20%, rgba(37,99,235,0.12), transparent 50%), var(--bg);
    }

    .home-topbar {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: calc(12px + env(safe-area-inset-top)) 16px 12px;
      border-bottom: 1px solid var(--line);
      background: rgba(7,7,10,0.9);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    .home-brand { display: flex; align-items: center; gap: 9px; }
    .conn-badge {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 10px; border-radius: 999px;
      background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2);
      font-size: 0.7rem; font-weight: 600; color: #34d399;
    }
    .conn-badge.offline { background: rgba(107,114,128,0.08); border-color: rgba(107,114,128,0.2); color: var(--muted); }
    .conn-badge.polling { background: rgba(251,191,36,0.08); border-color: rgba(251,191,36,0.22); color: #f59e0b; }
    .conn-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .conn-dot.pulse { animation: connPulse 1.6s ease-in-out infinite; }
    @keyframes connPulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }

    .home-body {
      flex: 1; min-height: 0;
      overflow-y: auto; -webkit-overflow-scrolling: touch;
      padding: 20px 14px 8px;
      display: flex; flex-direction: column; gap: 24px;
    }
    .home-body::-webkit-scrollbar { width: 3px; }
    .home-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

    /* Home search */
    .mode-toggle-row {
      display: none; gap: 6px; padding: 4px; margin-bottom: 12px;
      background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
    }
    .mode-toggle-btn {
      flex: 1; padding: 9px 10px; border-radius: 9px; border: 0; background: transparent;
      color: var(--muted); font-size: 0.82rem; font-weight: 700; font-family: inherit;
      cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .mode-toggle-btn.active { background: rgba(96,165,250,0.14); color: #93c5fd; }
    .home-search-row { display: flex; gap: 10px; align-items: center; }
    .home-search-wrap {
      flex: 1; display: flex; align-items: center; gap: 8px;
      background: var(--surface); border: 1px solid var(--line);
      border-radius: 12px; padding: 0 12px;
    }
    .home-search-icon { color: var(--muted); font-size: 1rem; flex: 0 0 auto; }
    #home-search {
      flex: 1; border: 0; background: transparent; color: var(--text);
      font: inherit; font-size: 0.88rem; padding: 10px 0; outline: none;
    }
    #home-search::placeholder { color: var(--muted); }
    .new-chat-pill {
      flex: 0 0 auto; padding: 10px 18px; border-radius: 12px;
      border: 0; background: linear-gradient(135deg, #60a5fa, #2563eb);
      color: #fff; font-size: 0.85rem; font-weight: 700;
      cursor: pointer; font-family: inherit;
      box-shadow: 0 6px 18px rgba(37,99,235,0.3);
      white-space: nowrap;
      transition: opacity 0.15s, transform 0.1s;
    }
    .new-chat-pill:active { transform: scale(0.97); opacity: 0.9; }

    /* Home sections */
    .home-section { display: flex; flex-direction: column; gap: 8px; }
    .home-section-title {
      font-size: 0.68rem; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.1em; color: var(--accent);
    }
    .home-section-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .home-clear-project {
      display:none; border:1px solid var(--line); background:rgba(255,255,255,0.04);
      color:var(--muted); border-radius:8px; padding:4px 8px; font-size:0.68rem;
      font-family:inherit; cursor:pointer;
    }
    .home-clear-project.visible { display:block; }

    /* Projects */
    .home-projects { display: flex; flex-direction: column; gap: 6px; }
    .home-proj-row {
      display: flex; align-items: center; gap: 12px;
      width: 100%; text-align: left; color: var(--text); font: inherit;
      padding: 12px 14px; border-radius: 13px;
      border: 1px solid var(--line); background: var(--surface);
      cursor: pointer; transition: background 0.15s, border-color 0.15s, transform 0.1s;
      touch-action: manipulation;
    }
    .home-proj-row:active { transform: scale(0.99); }
    .home-proj-row:hover { border-color: rgba(96,165,250,0.25); background: rgba(96,165,250,0.05); }
    .home-proj-row.selected { border-color: rgba(96,165,250,0.55); background: rgba(96,165,250,0.1); }
    .home-proj-icon {
      width: 36px; height: 36px; border-radius: 10px; flex: 0 0 auto;
      display: grid; place-items: center; font-size: 1.1rem;
      background: rgba(96,165,250,0.1); border: 1px solid rgba(96,165,250,0.15);
    }
    .home-proj-info { flex: 1; min-width: 0; }
    .home-proj-name { font-size: 0.9rem; font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .home-proj-path { font-size: 0.7rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
    .home-proj-count { font-size: 0.68rem; color: var(--muted); white-space: nowrap; }

    /* Recents */
    .home-recents { display: flex; flex-direction: column; gap: 2px; }
    .home-recent-row-wrap { display: flex; align-items: center; gap: 4px; border-radius: 10px; }
    .home-recent-row {
      display: flex; align-items: center; gap: 12px;
      flex: 1; min-width: 0; width: 100%; text-align: left; color: var(--text); font: inherit; background: transparent;
      padding: 10px 12px; border-radius: 10px;
      cursor: pointer; transition: background 0.15s, border-color 0.15s;
      border: 1px solid transparent;
      touch-action: manipulation;
    }
    .home-recent-row:hover { background: rgba(255,255,255,0.03); border-color: var(--line); }
    .home-recent-row:active { background: rgba(96,165,250,0.06); }
    .home-recent-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--muted); flex: 0 0 auto;
    }
    .home-recent-dot.running { background: var(--success); box-shadow: 0 0 6px rgba(16,185,129,0.5); }
    .home-recent-dot.attention { background: var(--warning); }
    .home-recent-info { flex: 1; min-width: 0; }
    .home-recent-title { font-size: 0.88rem; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .home-recent-meta { font-size: 0.7rem; color: var(--muted); margin-top: 2px; }
    .home-recent-time { font-size: 0.7rem; color: var(--muted); white-space: nowrap; flex: 0 0 auto; }
    .home-delete-chat {
      width:28px; height:28px; border-radius:8px; border:1px solid transparent;
      background:transparent; color:var(--muted); font-size:1rem; line-height:1;
      cursor:pointer; flex:0 0 auto; font-family:inherit;
    }
    .home-delete-chat:hover { color:#fca5a5; border-color:rgba(239,68,68,0.25); background:rgba(239,68,68,0.08); }
    .home-empty { color: var(--muted); font-size: 0.82rem; padding: 20px 0; text-align: center; }

    .phone-confirm-overlay {
      position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end;
      padding: 18px; background: rgba(0,0,0,0.62);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: opacity 0.18s ease, visibility 0s linear 0.18s;
    }
    .phone-confirm-overlay.visible { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity 0.18s ease, visibility 0s; }
    .phone-confirm-card {
      width: 100%; border-radius: 14px; border: 1px solid rgba(148,163,184,0.18);
      background: #111827; box-shadow: 0 -18px 50px rgba(0,0,0,0.42);
      padding: 16px; transform: translateY(14px) scale(0.985);
      transition: transform 0.22s cubic-bezier(0.2,0.8,0.2,1);
    }
    .phone-confirm-overlay.visible .phone-confirm-card { transform: translateY(0) scale(1); }
    .phone-confirm-title { color: var(--text); font-size: 1rem; font-weight: 800; margin-bottom: 6px; }
    .phone-confirm-message { color: var(--muted); font-size: 0.84rem; line-height: 1.45; margin-bottom: 14px; }
    .phone-confirm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .phone-confirm-btn {
      min-height: 42px; border-radius: 10px; border: 1px solid var(--line);
      background: rgba(15,23,42,0.9); color: var(--text); font: inherit; font-weight: 800;
    }
    .phone-confirm-btn.danger {
      border-color: rgba(255,123,123,0.32);
      background: linear-gradient(135deg, rgba(255,123,123,0.9), rgba(190,50,70,0.95));
      color: #fff;
    }

    /* Project detail */
    .project-screen-body {
      flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
      padding: 18px 14px calc(12px + env(safe-area-inset-bottom));
      display: flex; flex-direction: column; gap: 16px;
    }
    .project-summary {
      display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
      border-bottom:1px solid var(--line); padding-bottom:14px;
    }
    .project-summary-main { min-width:0; flex:1; }
    .project-summary-title { font-size:1.05rem; font-weight:800; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .project-summary-path { margin-top:4px; font-size:0.72rem; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .project-summary-meta { margin-top:8px; font-size:0.72rem; color:var(--accent); font-weight:700; }
    .project-thread-list { display:flex; flex-direction:column; gap:2px; }

    /* ═══════════════════════════════════════════════
       NEW CHAT SCREEN
    ═══════════════════════════════════════════════ */
    #screen-new-chat {
      background: radial-gradient(circle at 50% -20%, rgba(37,99,235,0.14), transparent 50%), var(--bg);
    }

    .new-chat-header {
      flex: 0 0 auto;
      display: flex; align-items: center; gap: 12px;
      padding: calc(12px + env(safe-area-inset-top)) 16px 12px;
      border-bottom: 1px solid var(--line);
      background: rgba(7,7,10,0.9);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    }
    .new-chat-header-title { font-size: 1rem; font-weight: 700; color: var(--text); }

    .new-chat-body {
      flex: 1; min-height: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 32px 24px;
      gap: 20px;
    }
    .dispatch-chat-intro {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      text-align: center;
      max-width: 330px;
    }
    .dispatch-chat-title {
      color: var(--text);
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: 0;
    }
    .dispatch-chat-copy {
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.45;
    }
    .coder-workspace-picker {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      width: 100%;
    }
    #screen-new-chat.dispatch-mode .dispatch-chat-intro,
    #screen-new-chat.operator-mode .dispatch-chat-intro,
    #screen-new-chat.researcher-mode .dispatch-chat-intro { display: flex; }
    #screen-new-chat.dispatch-mode .coder-workspace-picker,
    #screen-new-chat.operator-mode .coder-workspace-picker,
    #screen-new-chat.researcher-mode .coder-workspace-picker { display: none; }
    .lets-work-label { font-size: 1.05rem; color: var(--muted); font-weight: 500; text-align: center; }
    .proj-selector-btn {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 20px; border-radius: 16px;
      border: 1px solid rgba(96,165,250,0.25);
      background: rgba(96,165,250,0.06);
      color: var(--text); font-size: 1.05rem; font-weight: 700;
      cursor: pointer; font-family: inherit; width: 100%; max-width: 340px;
      transition: background 0.15s, border-color 0.15s;
      text-align: left;
    }
    .proj-selector-btn:hover { background: rgba(96,165,250,0.1); border-color: rgba(96,165,250,0.4); }
    .proj-selector-icon { font-size: 1.3rem; }
    .proj-selector-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .proj-selector-chevron { color: var(--muted); font-size: 0.9rem; }

    /* Project picker overlay (for new-chat screen) */
    .proj-picker-overlay {
      display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      z-index: 50; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
      pointer-events: none;
    }
    .proj-picker-overlay.open { display: flex; align-items: flex-end; pointer-events: auto; }
    .proj-picker-sheet {
      width: 100%; background: var(--surface2);
      border-radius: 20px 20px 0 0; border-top: 1px solid var(--line);
      padding: 0 0 calc(20px + env(safe-area-inset-bottom));
      max-height: 70vh; overflow-y: auto;
    }
    .proj-picker-handle { width: 36px; height: 4px; background: rgba(255,255,255,0.15); border-radius: 2px; margin: 10px auto 14px; }
    .proj-picker-title { font-size: 0.9rem; font-weight: 700; color: var(--text); padding: 0 18px 12px; border-bottom: 1px solid var(--line); }
    .proj-picker-list { padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
    .proj-picker-item {
      display: flex; align-items: center; gap: 12px;
      padding: 11px 13px; border-radius: 12px;
      border: 1px solid var(--line); background: rgba(17,17,23,0.7);
      cursor: pointer; transition: border-color 0.15s, background 0.15s;
    }
    .proj-picker-item:hover { border-color: rgba(96,165,250,0.3); background: rgba(96,165,250,0.07); }
    .proj-picker-item.selected { border-color: rgba(96,165,250,0.5); background: rgba(96,165,250,0.1); }
    .proj-picker-item-icon { font-size: 1.1rem; }
    .proj-picker-item-info { flex: 1; min-width: 0; }
    .proj-picker-item-name { font-size: 0.88rem; font-weight: 650; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .proj-picker-item-path { font-size: 0.7rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }

    .dispatch-sheet-overlay {
      position: fixed; inset: 0; z-index: 58; display: flex; align-items: flex-end;
      background: rgba(0,0,0,0.62); opacity: 0; visibility: hidden; pointer-events: none;
      backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
      transition: opacity 0.18s ease, visibility 0s linear 0.18s;
    }
    .dispatch-sheet-overlay.open { opacity: 1; visibility: visible; pointer-events: auto; transition-delay: 0s; }
    .dispatch-sheet {
      width: 100%; max-height: min(82vh, 760px); overflow-y: auto; padding: 0 16px calc(18px + env(safe-area-inset-bottom));
      border-top: 1px solid var(--line); border-radius: 16px 16px 0 0; background: var(--surface2);
      transform: translateY(24px); transition: transform 0.2s ease;
    }
    .dispatch-sheet-overlay.open .dispatch-sheet { transform: translateY(0); }
    .dispatch-sheet-handle { width: 36px; height: 4px; margin: 9px auto 13px; border-radius: 3px; background: rgba(255,255,255,0.16); }
    .dispatch-sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding-bottom: 14px; }
    .dispatch-sheet-title { color: var(--text); font-size: 1rem; font-weight: 800; }
    .dispatch-sheet-copy { margin-top: 4px; color: var(--muted); font-size: 0.74rem; line-height: 1.4; }
    .dispatch-sheet-close {
      width: 34px; height: 34px; flex: 0 0 auto; border: 1px solid var(--line); border-radius: 9px;
      background: rgba(255,255,255,0.04); color: var(--muted); font: inherit; cursor: pointer;
    }
    .dispatch-browser-search {
      display: flex; align-items: center; gap: 8px; min-height: 42px; margin-bottom: 14px; padding: 0 11px;
      border: 1px solid var(--line); border-radius: 10px; background: rgba(7,7,10,0.38); color: var(--muted);
    }
    .dispatch-browser-search input {
      min-height: 40px; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none;
    }
    .dispatch-browser-section-label {
      margin: 16px 0 5px; color: var(--muted); font-size: 0.68rem; font-weight: 850; text-transform: uppercase;
    }
    .dispatch-browser-project { border-bottom: 1px solid var(--line); }
    .dispatch-browser-project summary {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px;
      min-height: 58px; padding: 9px 2px; cursor: pointer; list-style: none;
    }
    .dispatch-browser-project summary::-webkit-details-marker { display: none; }
    .dispatch-browser-project-threads { padding: 0 0 8px 12px; }
    .dispatch-browser-thread {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px;
      width: 100%; min-height: 48px; padding: 8px 2px; border: 0; background: transparent;
      color: var(--text); text-align: left; font: inherit; cursor: pointer;
    }
    .dispatch-project-actions { display: grid; gap: 8px; margin: 4px 0 8px; }
    .dispatch-project-actions button {
      min-height: 46px; border-radius: 10px; font: inherit; font-size: 0.82rem; font-weight: 800; cursor: pointer;
    }
    .dispatch-project-primary { border: 1px solid rgba(130,115,244,0.45); background: var(--accent); color: #fff; }
    .dispatch-project-secondary { border: 1px solid var(--line); background: rgba(255,255,255,0.035); color: var(--text); }

    /* Settings */
    .settings-body {
      flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
      padding: 16px 14px calc(18px + env(safe-area-inset-bottom));
      display: flex; flex-direction: column; gap: 12px;
    }
    .settings-body::-webkit-scrollbar { width: 3px; }
    .settings-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
    .settings-card {
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface);
      padding: 14px; display: flex; flex-direction: column; gap: 11px;
    }
    .settings-card-title { font-size: 0.92rem; font-weight: 800; color: var(--text); }
    .settings-card-copy { font-size: 0.76rem; line-height: 1.45; color: var(--muted); }
    .settings-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .settings-row-label { min-width: 0; }
    .settings-row-title { font-size: 0.82rem; font-weight: 700; color: var(--text); }
    .settings-row-meta { font-size: 0.72rem; color: var(--muted); margin-top: 2px; }
    .settings-actions { display: flex; gap: 8px; }
    .settings-actions .btn-sm { flex: 1; min-height: 34px; }

    .new-chat-composer-area {
      flex: 0 0 auto; border-top: 1px solid var(--line);
      background: rgba(7,7,10,0.95);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      padding: 10px 14px calc(12px + env(safe-area-inset-bottom));
    }
    .new-chat-composer { display: flex; gap: 9px; align-items: flex-end; }

    /* ═══════════════════════════════════════════════
       MAIN SCREEN (Tab Layout)
    ═══════════════════════════════════════════════ */
    .app-header {
      flex: 0 0 auto;
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: calc(10px + env(safe-area-inset-top)) 14px 10px;
      border-bottom: 1px solid var(--line);
      background: rgba(7,7,10,0.92);
      backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
      z-index: 10;
    }
    .chat-header-center {
      flex: 1; min-width: 0; text-align: center;
      display: flex; flex-direction: column; align-items: center;
    }
    .chat-proj-name {
      font-size: 0.92rem; font-weight: 700; color: var(--text);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      max-width: 100%;
    }

    /* Tab panels container */
    .tab-panels {
      flex: 1; min-height: 0; position: relative; overflow: hidden;
    }
    .tab-panel {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      opacity: 0; visibility: hidden; pointer-events: none; z-index: 0;
      background: var(--bg); transition: opacity 0.18s ease, visibility 0s linear 0.18s;
    }
    .tab-panel.active { opacity: 1; visibility: visible; pointer-events: auto; z-index: 2; transition: opacity 0.18s ease; }

    /* ── Chat tab ─────────────────────────────────── */
    #panel-chat { overflow: hidden; }

    .messages {
      flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
      display: flex; flex-direction: column; gap: 10px;
      /* Deliberately NOT scroll-behavior: smooth. The list is rebuilt (innerHTML replaced,
         resetting scrollTop to 0) on every state update while a task runs; with smooth behavior
         each restore animates from 0 back to position, which reads as the view being repeatedly
         yanked. Programmatic scroll restores must be instant. */
      padding: 14px 12px 8px;
    }
    .messages::-webkit-scrollbar { width: 3px; }
    .messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

    .message {
      max-width: 84%; padding: 10px 13px; border-radius: 16px;
      font-size: 0.86rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
    }
    .message.user {
      align-self: flex-end;
      background: linear-gradient(135deg, rgba(37,99,235,0.22), rgba(96,165,250,0.14));
      border: 1px solid rgba(96,165,250,0.25); color: var(--text);
    }
    .message.user.phone-send-pending { animation: phone-send-appear 0.14s ease-out; }
    .message.user.phone-send-failed { border-color: rgba(248,113,113,0.55); }
    .phone-send-state { display: block; margin-top: 5px; color: var(--muted); font-size: 0.68rem; }
    .phone-send-failed .phone-send-state { color: #fca5a5; }
    @keyframes phone-send-appear { from { opacity: 0.55; transform: translateY(3px); } to { opacity: 1; transform: none; } }
    .message.assistant {
      align-self: flex-start; background: var(--surface);
      border: 1px solid rgba(16,185,129,0.12); color: var(--text);
    }
    .message.assistant.has-activity {
      max-width: 94%;
      padding: 9px;
      border-color: rgba(130,115,244,0.22);
      background: rgba(17,24,39,0.86);
    }
    .message.system {
      align-self: center; max-width: 96%; background: transparent;
      color: var(--muted); font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem; text-align: center; padding: 4px 8px; border: none;
    }
    .role { display: none; }
    .message code { font-family: 'JetBrains Mono', monospace; font-size: 0.82em; background: rgba(96,165,250,0.12); border: 1px solid rgba(96,165,250,0.16); border-radius: 4px; padding: 1px 5px; }
    .message pre { background: rgba(0,0,0,0.4); border: 1px solid var(--line); border-radius: 9px; padding: 10px 12px; overflow-x: auto; margin: 6px 0; }
    .message pre code { background: none; border: none; padding: 0; font-size: 0.8rem; color: #6ee7b7; }
    .message strong { font-weight: 700; }
    .message em { font-style: italic; color: #a5b4fc; }
    .message .agent-logs-container { margin: 0 0 10px; white-space: normal; }
    .message .message-answer { white-space: normal; }
    .message .message-answer p { margin: 0 0 10px; }
    .message .message-answer p:last-child { margin-bottom: 0; }
    .message .message-answer h1,
    .message .message-answer h2,
    .message .message-answer h3,
    .message .message-answer h4 {
      color: var(--text);
      line-height: 1.22;
      margin: 15px 0 8px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .message .message-answer h1:first-child,
    .message .message-answer h2:first-child,
    .message .message-answer h3:first-child,
    .message .message-answer h4:first-child { margin-top: 0; }
    /* Markdown-rendering cleanup: research-style output (headers separating sub-questions, a
       verdict, a Sources block) reads as a wall of near-identical text unless headings actually
       stand apart from body copy at this base 0.86rem message font. h1/h2 gained more size and
       weight; the h2 rule/accent-colored border makes section breaks scannable at a glance instead
       of blending into surrounding paragraphs. */
    .message .message-answer h1 { font-size: 1.18rem; font-weight: 800; margin-top: 18px; }
    .message .message-answer h2 {
      font-size: 1.05rem;
      padding-bottom: 7px;
      margin-top: 16px;
      border-bottom: 2px solid var(--accent, #60a5fa);
    }
    .message .message-answer h3 { font-size: 0.96rem; color: #c8c0ff; }
    .message .message-answer h4 { font-size: 0.88rem; color: var(--text); }
    .message .message-answer ul,
    .message .message-answer ol {
      margin: 8px 0 12px 18px;
      padding-left: 10px;
    }
    .message .message-answer li { margin: 5px 0; padding-left: 2px; }
    .message .message-answer strong { color: #fff; font-weight: 800; }
    .message .message-answer em { color: #c7d2fe; font-style: italic; }
    .message .message-answer a {
      color: #9db4ff;
      text-decoration: none;
      border-bottom: 1px solid rgba(157,180,255,0.35);
    }
    .message .message-answer blockquote {
      margin: 10px 0;
      padding: 7px 10px;
      border-left: 3px solid var(--accent);
      border-radius: 0 7px 7px 0;
      background: rgba(130,115,244,0.08);
      color: var(--muted);
    }
    .message .message-answer hr {
      border: 0;
      border-top: 1px solid var(--line);
      margin: 14px 0;
    }

    /* Inline assistant typing indicator */
    .message.typing-assistant {
      padding: 9px 13px;
      min-width: 0;
      width: auto;
    }
    .message.typing-assistant .typing-bubble {
      background: transparent;
      border: none;
      padding: 0;
    }
    .typing-bubble { display: flex; align-items: center; gap: 5px; background: var(--surface); border: 1px solid rgba(16,185,129,0.12); border-radius: 14px; padding: 9px 13px; }
    .typing-bubble .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); animation: typing-bounce 1.3s infinite ease-in-out; }
    .typing-bubble .dot:nth-child(2) { animation-delay: 0.18s; }
    .typing-bubble .dot:nth-child(3) { animation-delay: 0.36s; }
    @keyframes typing-bounce { 0%, 80%, 100% { transform: scale(0.55); opacity: 0.35; } 40% { transform: scale(1); opacity: 1; } }

    .empty { color: var(--muted); text-align: center; padding: 40px 16px; font-size: 0.8rem; }
    .dispatch-empty-chat {
      margin: auto;
      width: min(100%, 360px);
      padding: 28px 12px;
      text-align: center;
    }
    .dispatch-empty-title { color: var(--text); font-size: 1.18rem; font-weight: 800; }
    .dispatch-empty-status { margin-top: 5px; color: var(--muted); font-size: 0.78rem; }
    .dispatch-empty-actions {
      margin-top: 20px; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;
    }
    .dispatch-empty-action {
      border: 0; border-bottom: 1px solid rgba(148,163,184,0.28); background: transparent;
      color: #bfdbfe; padding: 6px 2px; font: inherit; font-size: 0.76rem; cursor: pointer;
    }
    .dispatch-empty-action:active { color: #fff; transform: none; }
    .dispatch-landing {
      width: 100%; max-width: 520px; margin: 0 auto; padding: 26px 16px 18px;
    }
    .dispatch-landing-intro { padding: 16px 2px 28px; }
    .dispatch-landing-title { color: var(--text); font-size: 1.32rem; font-weight: 850; letter-spacing: -0.02em; }
    .dispatch-landing-copy { margin-top: 7px; color: var(--muted); font-size: 0.84rem; line-height: 1.5; }
    .dispatch-landing-context {
      display: inline-flex; align-items: center; gap: 6px; margin-top: 10px;
      color: #c4b5fd; font-size: 0.74rem; font-weight: 700;
    }
    .dispatch-landing-section { padding: 14px 0 2px; border-top: 1px solid var(--line); }
    .dispatch-landing-section + .dispatch-landing-section { margin-top: 14px; }
    .dispatch-landing-section-head {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin-bottom: 4px; color: var(--muted); font-size: 0.72rem; font-weight: 800;
    }
    .dispatch-landing-browse {
      min-height: 34px; border: 0; background: transparent; color: #c4b5fd;
      font: inherit; font-size: 0.72rem; font-weight: 750; cursor: pointer;
    }
    .dispatch-project-row,
    .dispatch-work-row {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px;
      width: 100%; min-height: 52px; padding: 8px 2px; border: 0;
      border-bottom: 1px solid rgba(148,163,184,0.11); background: transparent;
      color: var(--text); text-align: left; font: inherit; cursor: pointer;
    }
    .dispatch-row-copy { display: block; min-width: 0; }
    .dispatch-row-title { display: block; overflow: hidden; font-size: 0.88rem; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
    .dispatch-row-meta {
      display: block; overflow: hidden; margin-top: 3px; color: var(--muted); font-size: 0.73rem;
      line-height: 1.35; text-overflow: ellipsis; white-space: nowrap;
    }
    .dispatch-row-time { color: var(--muted); font-size: 0.68rem; white-space: nowrap; }
    .dispatch-work-status { color: var(--success); font-size: 0.7rem; font-weight: 800; text-transform: capitalize; }
    .dispatch-work-status.blocked { color: var(--danger); }
    .dispatch-work-status.waiting { color: var(--warning); }
    .dispatch-browse-button {
      display: none; width: 36px; height: 36px; flex: 0 0 auto; border: 1px solid var(--line);
      border-radius: 9px; background: rgba(255,255,255,0.035); color: var(--muted);
      font: inherit; font-size: 1rem; cursor: pointer;
    }
    .dispatch-browse-button.visible { display: inline-grid; place-items: center; }
    .dispatch-running-banner {
      display: none; align-items: center; gap: 8px; flex: 0 0 auto;
      margin: 0 12px 8px; padding: 8px 10px; border: 1px solid rgba(16,185,129,0.2);
      border-radius: 8px; background: rgba(16,185,129,0.06); color: #a7f3d0;
      font: inherit; font-size: 0.72rem; font-weight: 700; text-align: left; cursor: pointer;
    }
    .dispatch-running-banner.visible { display: flex; }
    .dispatch-running-banner.operator-control { border-color: rgba(139,92,246,0.38); background: rgba(109,40,217,0.13); color: #ddd6fe; }
    .dispatch-running-banner.operator-control .dispatch-running-dot { background: #a78bfa; box-shadow: 0 0 9px rgba(139,92,246,0.72); }
    .dispatch-running-dot {
      width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; background: var(--success);
      box-shadow: 0 0 7px rgba(16,185,129,0.55); animation: connPulse 1.6s ease-in-out infinite;
    }
    .dispatch-running-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Composer area */
    .composer-area {
      flex: 0 0 auto; border-top: 1px solid var(--line);
      background: rgba(7,7,10,0.95); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    }
    .quick-chips {
      display: flex; gap: 7px; padding: 9px 12px 5px;
      overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;
    }
    .quick-chips::-webkit-scrollbar { display: none; }
    .form-mode-bar { display: none; align-items: center; gap: 8px; padding: 6px 14px 0; font-size: 0.76rem; font-weight: 650; }
    .form-mode-bar.visible { display: flex; }
    .form-mode-bar .mode-icon { font-size: 0.82rem; }
    .form-mode-bar .mode-label { color: var(--warning); }
    .form-mode-bar.revise-mode .mode-label { color: var(--accent); }
    .form-mode-bar .mode-cancel { margin-left: auto; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,0.06); border: 1px solid var(--line); color: var(--muted); font-size: 0.72rem; cursor: pointer; font-family: inherit; }
    #prompt-form { padding: 8px 12px calc(10px + env(safe-area-inset-bottom)); }
    .composer { display: flex; gap: 9px; align-items: flex-end; }
    /* Model + reasoning pickers directly above the composer — thumb-reachable, quiet until
       a non-auto reasoning level is pinned, then tinted so the cost is never invisible. */
    .composer-model-bar { display: flex; gap: 7px; padding: 7px 12px 0; }
    .composer-model-bar select {
      flex: 1; min-width: 0; -webkit-appearance: none; appearance: none;
      background: var(--surface2); border: 1px solid var(--line); border-radius: 9px;
      color: var(--muted); font-family: inherit; font-size: 0.74rem; font-weight: 600;
      padding: 6px 9px; outline: none; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
    }
    .composer-model-bar select:focus { border-color: rgba(96,165,250,0.45); }
    .composer-model-bar select#composer-reasoning-select { flex: 0 0 auto; max-width: 44%; }
    .composer-model-bar select.reasoning-forced {
      color: #a5b4fc; border-color: rgba(129,140,248,0.42); background: rgba(99,102,241,0.12);
    }

    textarea {
      width: 100%; min-height: 44px; max-height: 110px; resize: none;
      border: 1px solid rgba(96,165,250,0.2); border-radius: 14px;
      padding: 11px 13px; background: var(--surface); color: var(--text);
      font: inherit; font-size: 0.9rem; line-height: 1.35; outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    textarea::placeholder { color: var(--muted); }
    textarea:focus { border-color: rgba(96,165,250,0.45); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    button.send-button {
      flex: 0 0 auto; width: 44px; height: 44px; border: 0; border-radius: 12px;
      background: linear-gradient(145deg, #60a5fa, #2563eb); color: #fff;
      font-size: 1.2rem; font-weight: 900; cursor: pointer; font-family: inherit;
      display: grid; place-items: center; box-shadow: 0 8px 20px rgba(37,99,235,0.3);
      transition: opacity 0.15s, transform 0.1s;
    }
    button.send-button::before { content: "\\2191"; }
    button.send-button:active { transform: scale(0.95); }
    button.send-button.sending::before { content: ""; display: block; width: 18px; height: 18px; border: 2.5px solid rgba(255,255,255,0.35); border-top-color: #fff; border-radius: 50%; animation: sendSpin 0.7s linear infinite; }
    button.send-button.sending { opacity: 0.85; cursor: default; pointer-events: none; }
    @keyframes sendSpin { to { transform: rotate(360deg); } }

    /* Image/file attach in composer */
    .phone-img-preview {
      padding: 8px 12px 2px; display: flex; align-items: center; gap: 10px;
    }
    .phone-img-preview img {
      width: 72px; height: 72px; border-radius: 10px;
      object-fit: cover; border: 1px solid var(--line);
    }
    .phone-file-preview {
      padding: 8px 12px 2px; display: flex; align-items: center; gap: 10px;
    }
    .phone-file-chip {
      display: flex; align-items: center; gap: 6px;
      background: rgba(96,165,250,0.12); border: 1px solid rgba(96,165,250,0.3);
      border-radius: 8px; padding: 5px 10px; font-size: 0.78rem; color: var(--accent);
      max-width: 220px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    }
    .phone-img-remove {
      width: 28px; height: 28px; border-radius: 50%;
      border: 1px solid var(--line); background: rgba(255,255,255,0.06);
      color: var(--text); font-size: 0.9rem; cursor: pointer; font-family: inherit;
      display: grid; place-items: center; flex: 0 0 auto;
    }
    button.attach-image-btn {
      flex: 0 0 auto; width: 40px; height: 40px; border: 1px solid var(--line);
      border-radius: 10px; background: var(--surface);
      color: var(--muted); font-size: 1.15rem; cursor: pointer; font-family: inherit;
      display: grid; place-items: center;
      transition: background 0.15s, border-color 0.15s;
    }
    button.attach-image-btn:hover { background: var(--surface2); border-color: rgba(96,165,250,0.3); }
    button.attach-image-btn.has-image { color: var(--accent); border-color: var(--accent); }
    /* Attach picker sheet */
    .attach-sheet-overlay {
      position: fixed; inset: 0; z-index: 900; background: rgba(0,0,0,0.5);
      display: none; align-items: flex-end; justify-content: center;
    }
    .attach-sheet-overlay.open { display: flex; }
    .attach-sheet {
      width: 100%; max-width: 520px; background: var(--surface);
      border-radius: 18px 18px 0 0;
      padding: 14px 16px calc(20px + env(safe-area-inset-bottom));
    }
    .attach-sheet-title {
      text-align: center; font-size: 0.68rem; font-weight: 800;
      letter-spacing: 0.09em; text-transform: uppercase;
      color: var(--muted); margin-bottom: 14px;
    }
    .attach-sheet-btn {
      display: flex; align-items: center; gap: 12px; width: 100%;
      padding: 13px 14px; border-radius: 10px; border: 1px solid var(--line);
      background: var(--surface2); color: var(--text); font-size: 0.92rem;
      cursor: pointer; font-family: inherit; margin-bottom: 8px;
      transition: opacity 0.12s;
    }
    .attach-sheet-btn:active { opacity: 0.65; }
    .attach-sheet-btn .asi { font-size: 1.25rem; width: 28px; text-align: center; }
    .attach-sheet-cancel {
      width: 100%; margin-top: 4px; padding: 13px 14px; border-radius: 10px;
      border: 1px solid rgba(239,68,68,0.25); background: rgba(239,68,68,0.07);
      color: #f87171; font-size: 0.92rem; font-weight: 600; cursor: pointer;
      font-family: inherit; transition: opacity 0.12s;
    }
    .attach-sheet-cancel:active { opacity: 0.65; }
    /* Changed-file download rows in Logs tab */
    .file-dl-row {
      display: flex; align-items: center; gap: 8px; padding: 6px 0;
      border-bottom: 1px solid var(--line);
    }
    .file-dl-row:last-child { border-bottom: none; }
    .file-dl-name {
      flex: 1; font-family: monospace; font-size: 0.72rem; min-width: 0;
      overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    }
    .file-dl-btn {
      flex: 0 0 auto; padding: 3px 10px; border-radius: 6px; font-size: 0.68rem;
      font-weight: 700; border: 1px solid rgba(96,165,250,0.4);
      background: rgba(96,165,250,0.1); color: var(--accent);
      cursor: pointer; font-family: inherit; transition: opacity 0.12s;
    }
    .file-dl-btn:active { opacity: 0.65; }

    /* Update available banner */
    .update-banner {
      display: none; padding: 10px 13px; border-radius: 10px; font-size: 0.8rem;
      align-items: center; justify-content: space-between; gap: 10px;
      background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.25); color: #34d399;
    }
    .update-banner.visible { display: flex; }
    .update-banner-text { flex: 1; font-weight: 500; }
    .update-apply-btn {
      flex: 0 0 auto; padding: 5px 12px; border-radius: 8px; border: 0;
      background: #34d399; color: #0c0c0e; font-weight: 700; font-size: 0.76rem;
      cursor: pointer; font-family: inherit; transition: opacity 0.15s;
    }
    .update-apply-btn:active { opacity: 0.8; }
    /* Message images */
    .message-image { max-width: 100%; max-height: 260px; border-radius: 10px; display: block; margin: 6px 0; border: 1px solid var(--line); cursor: zoom-in; }
    .message-image-figure { margin: 8px 0; }
    .message-image-status { display: inline-block; color: var(--muted); font-size: .76rem; line-height: 1.35; padding: 7px 0; cursor: pointer; }
    .message-image-figure figcaption { margin-top: 5px; color: var(--muted); font-size: .76rem; line-height: 1.35; }
    .image-lightbox {
      position: fixed; inset: 0; z-index: 1200; display: none; flex-direction: column;
      background: rgba(2,4,10,.96); padding: max(10px, env(safe-area-inset-top)) 10px max(10px, env(safe-area-inset-bottom));
    }
    .image-lightbox.open { display: flex; }
    .image-lightbox-header, .image-lightbox-controls {
      flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .image-lightbox-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: .82rem; }
    .image-lightbox-button {
      min-width: 42px; min-height: 42px; padding: 8px 12px; border: 1px solid var(--line);
      border-radius: 9px; background: var(--surface2); color: var(--text); font: inherit; font-weight: 700;
    }
    .image-lightbox-viewport {
      flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; margin: 10px 0;
      display: flex; align-items: center; justify-content: center; overscroll-behavior: contain;
      touch-action: pan-x pan-y pinch-zoom;
    }
    .image-lightbox-viewport.zoomed { align-items: flex-start; justify-content: flex-start; }
    .image-lightbox-image { display: block; width: auto; height: auto; max-width: 100%; max-height: 100%; }
    .image-lightbox-zoom { flex: 1; text-align: center; color: var(--muted); font-size: .78rem; }

    #task-list-card { grid-area: mission; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
    }

    /* ── Status tab ───────────────────────────────── */
    #panel-status {
      overflow-y: auto; -webkit-overflow-scrolling: touch;
      padding: 14px 14px calc(14px + env(safe-area-inset-bottom));
      gap: 12px; display: flex; flex-direction: column;
    }
    #panel-status::-webkit-scrollbar { width: 3px; }
    #panel-status::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

    .indicator-banner {
      padding: 9px 13px; border-radius: 10px; font-size: 0.78rem;
      display: flex; align-items: center; justify-content: space-between;
      border: 1px solid transparent; font-weight: 500;
    }
    .indicator-banner.active-running { background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.2); color: #34d399; }
    .indicator-banner.operator-running { background: rgba(109,40,217,0.12); border-color: rgba(139,92,246,0.32); color: #c4b5fd; }
    .indicator-banner.background-running { background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.22); color: #fbbf24; }
    .indicator-banner.background-running button { background: #fbbf24; color: #0c0c0e; font-weight: 700; border: 0; padding: 4px 9px; border-radius: 6px; font-size: 0.72rem; cursor: pointer; font-family: inherit; }
    .indicator-banner.idle { background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.05); color: var(--muted); }

    .status-card { padding: 13px 14px; border-radius: 13px; border: 1px solid var(--line); background: var(--surface); }
    .status-card.active-card { border-left: 3px solid var(--accent); background: linear-gradient(180deg, rgba(37,99,235,0.06), var(--surface)); }
    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
    .card-title { font-size: 0.92rem; font-weight: 700; color: var(--text); margin-bottom: 4px; }
    .substatus-text { font-size: 0.74rem; color: var(--muted); }
    .info-card { display: flex; flex-direction: column; gap: 7px; }
    .info-row { display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem; }
    .info-label { color: var(--muted); }
    .info-value { color: var(--text); font-weight: 600; text-align: right; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .info-model-select { background: var(--surface2); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-family: inherit; font-size: 0.76rem; font-weight: 600; padding: 3px 6px; max-width: 62%; cursor: pointer; outline: none; }
    .section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .section-title { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); flex: 1; }

    .badge { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 4px; font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .badge.success { background: rgba(16,185,129,0.12); color: #34d399; border: 1px solid rgba(16,185,129,0.22); }
    .badge.warning { background: rgba(245,158,11,0.12); color: #fbbf24; border: 1px solid rgba(245,158,11,0.22); }
    .badge.operator { background: rgba(109,40,217,0.13); color: #c4b5fd; border: 1px solid rgba(139,92,246,0.3); }
    .badge.danger  { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.22); }
    .badge.muted   { background: rgba(255,255,255,0.04); color: var(--muted); border: 1px solid rgba(255,255,255,0.06); }
    .badge.active-view { background: rgba(37,99,235,0.12); color: #93c5fd; border: 1px solid rgba(96,165,250,0.22); }
    .badge.pulse { animation: status-pulse 1.8s infinite; }
    @keyframes status-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }

    .ctx-controls-running, .ctx-controls-idle { display: none; }
    .ctx-controls-running.visible, .ctx-controls-idle.visible { display: block; }
    .control-row { display: flex; gap: 8px; }
    .ctrl-btn { flex: 1; min-height: 40px; border-radius: 10px; background: var(--surface); border: 1px solid var(--line); color: var(--text); font-size: 0.8rem; font-weight: 700; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s; }
    .ctrl-btn:hover { border-color: rgba(96,165,250,0.3); background: rgba(96,165,250,0.06); }

    .plan-panel { display: none; padding: 14px; margin: 0 14px 14px; border-radius: 13px; border: 1px solid rgba(245,158,11,0.28); background: rgba(245,158,11,0.05); }
    .plan-panel.visible { display: block; }
    .plan-title { font-size: 0.86rem; font-weight: 800; color: #fbbf24; margin-bottom: 4px; }
    .plan-copy { font-size: 0.76rem; color: var(--muted); line-height: 1.4; margin-bottom: 10px; }
    .approve-button { width: 100%; min-height: 42px; border-radius: 10px; border: 0; background: var(--warning); color: #0c0c0e; font-weight: 800; font-size: 0.88rem; cursor: pointer; font-family: inherit; margin-bottom: 8px; box-shadow: 0 8px 20px rgba(245,158,11,0.18); }
    .approve-button.approved { background: linear-gradient(145deg, #34d399, #059669); color: #fff; cursor: default; }

    .message.assistant.clarification-message {
      max-width: 96%;
      padding: 14px;
      border-radius: 13px;
      border: 1px solid rgba(96,165,250,0.28);
      background: rgba(96,165,250,0.05);
      white-space: normal;
    }
    .clarification-intro { font-size: 0.82rem; color: var(--text); line-height: 1.4; margin-bottom: 12px; }
    .clarification-question-block { margin-bottom: 14px; }
    .clarification-question-block.unanswered { margin-left: -8px; margin-right: -8px; padding: 8px; border-radius: 10px; outline: 1px solid rgba(255,123,123,0.55); background: rgba(255,123,123,0.06); animation: clarification-nudge 240ms ease-out; scroll-margin: 84px 0 150px; }
    @keyframes clarification-nudge { 0% { transform: translateX(0); } 35% { transform: translateX(4px); } 70% { transform: translateX(-3px); } 100% { transform: translateX(0); } }
    .clarification-question-header { margin-bottom: 8px; }
    .clarification-chip { display: inline-block; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-bottom: 3px; }
    .clarification-question-text { display: block; font-size: 0.84rem; font-weight: 700; color: var(--text); }
    .clarification-options { display: flex; flex-direction: column; gap: 6px; }
    .clarification-option, .clarification-other-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); cursor: pointer; }
    .clarification-option:has(input:checked), .clarification-other-row:has(input:checked) { border-color: rgba(96,165,250,0.45); background: rgba(96,165,250,0.08); }
    .clarification-option input[type="radio"], .clarification-other-row input[type="radio"] { margin-top: 2px; accent-color: var(--accent); }
    .clarification-option-body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .clarification-option-label-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .clarification-option-label { font-size: 0.8rem; font-weight: 700; color: var(--text); }
    .clarification-recommended-badge { font-size: 0.62rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #34d399; background: rgba(52,211,153,0.12); border: 1px solid rgba(52,211,153,0.25); border-radius: 999px; padding: 1px 6px; }
    .clarification-option-desc { font-size: 0.72rem; color: var(--muted); line-height: 1.35; }
    .clarification-other-row { flex-wrap: wrap; }
    .clarification-other-input { flex: 1; min-width: 0; background: transparent; border: none; border-bottom: 1px solid var(--line); color: var(--text); font-size: 0.78rem; font-family: inherit; padding: 2px 0; }
    .clarification-other-input:focus { outline: none; border-bottom-color: var(--accent); }
    .clarification-actions { margin-top: 4px; }
    .btn-clarification-submit { width: 100%; min-height: 42px; border-radius: 10px; border: 0; background: var(--accent); color: #fff; font-weight: 800; font-size: 0.86rem; cursor: pointer; font-family: inherit; }
    .btn-clarification-submit:disabled { opacity: 0.6; cursor: default; }

    @keyframes card-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    .task-list-card { display: none; }
    .task-list-card.visible { display: block; animation: card-enter 0.2s ease both; }
    .task-list-progress { font-size: 0.68rem; color: var(--muted); font-weight: 700; }
    .phone-task-list { display: flex; flex-direction: column; gap: 7px; }
    .phone-task-item {
      display: flex; align-items: flex-start; gap: 9px;
      padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.05);
      color: var(--muted); font-size: 0.78rem; line-height: 1.35;
    }
    .phone-task-item:first-child { border-top: 0; padding-top: 0; }
    .phone-task-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; margin-top: 4px; background: var(--muted); }
    .phone-task-item.in-progress .phone-task-dot { background: var(--warning); box-shadow: 0 0 8px rgba(245,196,81,0.28); }
    .phone-task-item.completed .phone-task-dot { background: var(--success); }
    .phone-task-item.completed .phone-task-title { text-decoration: line-through; color: var(--muted); }
    .phone-task-title { color: var(--text); font-weight: 650; }

    .home-approval-list { display: flex; flex-direction: column; gap: 8px; }
    .home-approval-card {
      border: 1px solid rgba(245,196,81,0.26); border-radius: 12px;
      background: rgba(245,196,81,0.05); padding: 12px;
      display: flex; flex-direction: column; gap: 9px;
    }
    .home-approval-title { font-size: 0.88rem; font-weight: 750; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .home-approval-meta { font-size: 0.72rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .home-approval-actions { display: flex; gap: 8px; }
    .home-approval-actions .btn-sm { flex: 1; min-height: 34px; }
    .btn-sm.danger { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.35); color: #f87171; }

    .queued-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
    .queued-item { font-size: 0.74rem; color: var(--text); background: rgba(255,255,255,0.02); padding: 7px; border-radius: 7px; border: 1px solid var(--line); }
    .attention-card { border: 1px solid rgba(245,158,11,0.22); background: rgba(245,158,11,0.04); }

    .recent-tasks-list { display: flex; flex-direction: column; gap: 2px; }
    .task-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
    .task-row:hover { background: rgba(255,255,255,0.03); border-color: var(--line); }
    .task-row.active-row { background: rgba(96,165,250,0.06); border-color: rgba(96,165,250,0.2); }
    .task-row-title { font-size: 0.84rem; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .task-row-meta { font-size: 0.7rem; color: var(--muted); margin-top: 2px; }
    .btn-sm { padding: 5px 10px; font-size: 0.74rem; border-radius: 7px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); color: var(--text); cursor: pointer; font-family: inherit; font-weight: 600; }

    /* ── Logs tab ─────────────────────────────────── */
    #panel-logs { overflow: hidden; }
    .logs-sub-tabs { flex: 0 0 auto; display: flex; gap: 4px; padding: 10px 12px 8px; border-bottom: 1px solid var(--line); background: var(--bg); overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
    .logs-sub-tabs::-webkit-scrollbar { display: none; }
    .log-tab-btn { flex: 0 0 auto; padding: 5px 12px; border-radius: 7px; border: 1px solid transparent; background: transparent; color: var(--muted); font-size: 0.74rem; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, color 0.15s, border-color 0.15s; }
    .log-tab-btn.active { background: rgba(96,165,250,0.12); color: #93c5fd; border-color: rgba(96,165,250,0.24); }
    .logs-content { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 12px; }
    .logs-content::-webkit-scrollbar { width: 3px; }
    .logs-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
    .tab-pane { display: none; font-size: 0.76rem; color: var(--muted); white-space: pre-wrap; word-break: break-all; line-height: 1.45; }
    .tab-pane.active { display: block; }
    .terminal-logs { font-family: 'JetBrains Mono', Consolas, monospace; background: #030408; color: #34d399; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); font-size: 0.69rem; line-height: 1.4; overflow: auto; margin-top: 8px; }
    .test-result-block { border-bottom: 1px solid var(--line); padding-bottom: 6px; margin-bottom: 6px; font-family: 'JetBrains Mono', monospace; white-space: pre-wrap; }
    .test-result-block:last-child { border-bottom: 0; }

    html, body, .app-root { background: var(--bg); color: var(--text); }
    .app-root {
      background:
        radial-gradient(circle at 20% 0%, rgba(130,115,244,0.14), transparent 32%),
        linear-gradient(180deg, #090b12 0%, #0b0f18 52%, #090b12 100%);
    }
    .home-topbar, .app-header, .bottom-nav {
      background: rgba(9,11,18,0.9);
      border-color: var(--line);
      box-shadow: 0 14px 36px rgba(0,0,0,0.24);
    }
    .mark, button.send-button, .sheet-start-btn, .approve-button {
      background: var(--gradient-mark);
      box-shadow: 0 12px 28px rgba(130,115,244,0.26);
    }
    .status-card, .plan-panel, .queued-item, .terminal-logs, .proj-tile, .sheet-textarea, .ctrl-btn, .btn-sm {
      border-color: var(--line);
      background: rgba(17,24,39,0.72);
      border-radius: 8px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
    }
    .status-card.active-card {
      border-left: 0;
      border-color: rgba(130,115,244,0.34);
      background: linear-gradient(180deg, rgba(130,115,244,0.12), rgba(17,24,39,0.72));
    }
    .section-title, .nav-btn.active, .task-row.active-row .task-row-title { color: var(--accent); }
    .badge.active-view, .log-tab-btn.active {
      background: rgba(130,115,244,0.14);
      border-color: rgba(130,115,244,0.34);
      color: #c8c0ff;
    }
    .badge.success { background: rgba(70,213,155,0.12); border-color: rgba(70,213,155,0.28); color: var(--success); }
    .badge.warning { background: rgba(245,196,81,0.12); border-color: rgba(245,196,81,0.28); color: var(--warning); }
    .badge.danger { background: rgba(255,123,123,0.11); border-color: rgba(255,123,123,0.26); color: var(--danger); }
    .plan-panel {
      border-color: rgba(130,115,244,0.36);
      background: linear-gradient(180deg, rgba(130,115,244,0.13), rgba(17,24,39,0.8));
    }
    .plan-title { color: var(--text); }
    .approve-button { color: #ffffff; }
    .approve-button.approved { background: linear-gradient(135deg, #46d59b, #1d9f72); }
    .logs-sub-tabs { background: rgba(9,11,18,0.92); }
    .agent-logs-container {
      margin: 0 0 12px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(9,11,18,0.68);
    }
    .agent-logs-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 11px;
      border-bottom: 1px solid var(--line);
      background: rgba(255,255,255,0.025);
      color: var(--muted);
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
      user-select: none;
    }
    .agent-logs-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
    }
    .agent-logs-container.collapsed .agent-logs-body { display: none; }
    .agent-logs-container.collapsed .agent-logs-header { border-bottom: none; }
    .dispatch-activity-log {
      border-color: rgba(70,213,155,0.2);
      background: rgba(9,18,18,0.62);
    }
    .dispatch-activity-log .agent-logs-header {
      color: var(--text);
      background: rgba(70,213,155,0.055);
    }
    .dispatch-current-tool {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }
    .dispatch-tool-pulse {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--success);
      box-shadow: 0 0 0 4px rgba(70,213,155,0.12);
      flex: 0 0 auto;
    }
    .dispatch-current-tool code {
      color: #b8a9ff;
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 0.72rem;
    }
    .tool-run-badge {
      background: rgba(9,11,18,0.45);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 0.72rem;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .tool-call-info {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .tool-name {
      color: #b8a9ff;
      font-weight: 700;
    }
    .tool-status {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.6rem;
      font-weight: 800;
      text-transform: uppercase;
      background: rgba(255,255,255,0.06);
      color: var(--muted);
    }
    .tool-status.success { background: rgba(70,213,155,0.12); color: var(--success); }
    .tool-status.error { background: rgba(255,75,75,0.12); color: #ff5e5e; }
    .tool-params {
      color: var(--muted);
      font-size: 0.68rem;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .tool-result-label {
      color: var(--muted);
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      margin-top: 4px;
    }
    .tool-result-box {
      background: rgba(0,0,0,0.25);
      border: 1px solid rgba(255,255,255,0.04);
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 0.68rem;
      color: var(--text);
      max-height: 140px;
      overflow-y: auto;
      white-space: pre;
      scrollbar-width: none;
    }
    .tool-result-box::-webkit-scrollbar { display: none; }
    .thought-block {
      border-left: 2px solid var(--accent);
      padding-left: 10px;
      color: var(--muted);
      font-size: 0.82rem;
      font-style: italic;
      line-height: 1.4;
    }
    .tool-run-badge {
      display: flex;
      flex-direction: column;
      gap: 5px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: rgba(17,24,39,0.84);
      padding: 8px;
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 0.72rem;
    }
    .tool-call-info {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }
    .tool-name {
      min-width: 0;
      overflow: hidden;
      color: var(--accent);
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tool-status {
      flex: 0 0 auto;
      border-radius: 4px;
      padding: 2px 6px;
      background: rgba(148,163,184,0.16);
      color: var(--muted);
      font-size: 0.62rem;
      font-weight: 800;
      text-transform: uppercase;
    }
    .tool-status.done, .tool-status.success { background: rgba(70,213,155,0.12); color: var(--success); }
    .tool-status.error, .tool-status.failed { background: rgba(255,123,123,0.12); color: var(--danger); }
    .tool-params {
      color: var(--muted);
      font-size: 0.68rem;
      line-height: 1.35;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .tool-result-label {
      color: var(--muted);
      font-size: 0.64rem;
      font-weight: 800;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .tool-result-box {
      max-height: 150px;
      overflow: auto;
      border-radius: 6px;
      background: rgba(0,0,0,0.24);
      color: var(--text);
      padding: 7px;
      line-height: 1.35;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .latest-output-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(9,11,18,0.45);
      padding: 10px 11px;
      color: var(--muted);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    /* ── Bottom navigation ────────────────────────── */
    .bottom-nav { flex: 0 0 auto; display: flex; border-top: 1px solid var(--line); background: rgba(7,7,10,0.96); padding-bottom: env(safe-area-inset-bottom); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
    .bottom-nav.hidden { display: none; }
    .nav-btn { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 9px 4px; border: 0; background: transparent; color: var(--muted); cursor: pointer; font-family: inherit; transition: color 0.15s; position: relative; }
    .nav-btn.active { color: var(--accent); }
    .nav-btn.active::after { content: ''; position: absolute; top: 0; left: 30%; right: 30%; height: 2px; background: var(--accent); border-radius: 0 0 2px 2px; }
    .nav-icon { font-size: 1.2rem; line-height: 1; }
    .nav-label { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.02em; }

    /* ── New Task Sheet ───────────────────────────── */
    .sheet-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:40; backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); pointer-events:none; }
    .sheet-overlay.open { display:block; pointer-events:auto; }
    .new-task-sheet { position:fixed; bottom:0; left:0; right:0; z-index:41; background:var(--surface2); border-radius:20px 20px 0 0; border-top:1px solid var(--line); box-shadow:0 -24px 60px rgba(0,0,0,0.5); padding-bottom:calc(20px + env(safe-area-inset-bottom)); transform:translateY(100%); transition:transform 0.3s cubic-bezier(0.2,0.8,0.2,1), visibility 0s linear 0.3s; max-height:86vh; overflow-y:auto; visibility:hidden; pointer-events:none; }
    .new-task-sheet.open { transform:translateY(0); visibility:visible; pointer-events:auto; transition:transform 0.3s cubic-bezier(0.2,0.8,0.2,1), visibility 0s; }
    .sheet-handle { width:36px; height:4px; background:rgba(255,255,255,0.15); border-radius:2px; margin:10px auto 16px; }
    .sheet-header { padding:0 18px 12px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--line); }
    .sheet-title { font-size:1rem; font-weight:700; color:var(--text); }
    .sheet-close-btn { width:28px; height:28px; border-radius:50%; background:rgba(255,255,255,0.07); border:1px solid var(--line); color:var(--muted); font-size:1rem; cursor:pointer; display:grid; place-items:center; line-height:1; font-family:inherit; }
    .sheet-section { padding:14px 18px 0; }
    .sheet-label { font-size:0.68rem; font-weight:700; letter-spacing:0.08em; color:var(--muted); text-transform:uppercase; margin-bottom:9px; }
    .proj-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .proj-tile { padding:11px 13px; border-radius:13px; border:1px solid var(--line); background:rgba(17,23,36,0.7); cursor:pointer; transition:border-color 0.15s,background 0.15s,transform 0.12s; text-align:left; }
    .proj-tile:active { transform:scale(0.97); }
    .proj-tile.selected { border-color:rgba(96,165,250,0.5); background:rgba(96,165,250,0.1); }
    .proj-tile.standalone { grid-column:1/-1; border-color:rgba(16,185,129,0.22); background:rgba(16,185,129,0.04); }
    .proj-tile.standalone.selected { border-color:rgba(16,185,129,0.5); background:rgba(16,185,129,0.1); }
    .proj-tile-name { font-size:0.86rem; font-weight:650; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .proj-tile.standalone .proj-tile-name { color:var(--success); }
    .proj-tile-meta { font-size:0.71rem; color:var(--muted); margin-top:3px; }
    .sheet-textarea { width:100%; min-height:78px; background:rgba(0,0,0,0.3); border:1px solid var(--line); border-radius:12px; color:var(--text); font-size:0.92rem; font-family:inherit; padding:12px 14px; resize:none; outline:none; box-sizing:border-box; margin-top:10px; }
    .sheet-textarea:focus { border-color:rgba(96,165,250,0.5); box-shadow:0 0 0 3px rgba(37,99,235,0.09); }
    .sheet-textarea::placeholder { color:var(--muted); }
    .sheet-start-btn { margin-top:10px; width:100%; min-height:46px; border-radius:12px; background:linear-gradient(145deg,#60a5fa,#2563eb); color:white; font-size:0.92rem; font-weight:700; border:0; cursor:pointer; box-shadow:0 10px 24px rgba(37,99,235,0.28); transition:opacity 0.15s,transform 0.1s; }
    .sheet-start-btn:active { transform:scale(0.98); opacity:0.9; }
    .sheet-start-btn:disabled { opacity:0.45; cursor:not-allowed; }

    /* Desktop-aligned Orion mobile final overrides */
    .bottom-nav, .logs-sub-tabs, .home-topbar, .app-header {
      background: rgba(9,11,18,0.92);
      border-color: var(--line);
    }
    .chip:hover, .ctrl-btn:hover, .task-row.active-row, .proj-tile.selected, .sheet-textarea:focus {
      border-color: rgba(130,115,244,0.42);
      background: rgba(130,115,244,0.09);
    }

    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }
    @media (min-width: 700px) { .app-root { max-width: 760px; margin: 0 auto; border-left: 1px solid rgba(255,255,255,0.05); border-right: 1px solid rgba(255,255,255,0.05); } }
  
    .reconnect-banner { position: fixed; top: calc(env(safe-area-inset-top) + 10px); left: 50%; max-width: calc(100vw - 32px); border: 1px solid rgba(96,165,250,0.28); border-radius: 999px; background: rgba(12,18,31,0.92); box-shadow: 0 8px 28px rgba(0,0,0,0.28); color: #bfdbfe; text-align: center; font-size: 12px; font-weight: 600; padding: 7px 12px; opacity: 0; pointer-events: none; transform: translate(-50%, -10px); transition: opacity 0.18s ease, transform 0.18s ease; z-index: 9999; }
    .reconnect-banner.active { opacity: 1; transform: translate(-50%, 0); }
    .chat-footer { padding-bottom: calc(env(safe-area-inset-bottom) + 12px) !important; position: sticky; bottom: 0; background: var(--bg-primary); z-index: 10; }
</style>
</head>
<body>
<div class="app-root">
  <div id="reconnect-banner" class="reconnect-banner">Reconnecting to Orion...</div>
  <div class="drawer-overlay" id="app-drawer-overlay" role="dialog" aria-modal="true" aria-labelledby="app-drawer-title">
    <aside class="app-drawer">
      <div class="drawer-head">
        <div class="drawer-title" id="app-drawer-title">Orion</div>
        <button class="drawer-close" id="app-drawer-close" type="button" aria-label="Close menu">&#x2715;</button>
      </div>
      <nav class="drawer-nav" aria-label="Main">
        <button class="drawer-nav-btn" data-drawer-destination="orion" type="button">
          <span>Dispatch</span><span class="drawer-nav-sub">Chat</span>
        </button>
${specialistDrawerButtons}
        <button class="drawer-nav-btn" data-drawer-destination="settings" type="button">
          <span>Settings</span><span class="drawer-nav-sub">App</span>
        </button>
      </nav>
      <div class="drawer-meta" id="drawer-meta">Connected to ${machineName || 'Desktop'}</div>
    </aside>
  </div>

  <!-- ═══ HOME SCREEN ═══════════════════════════════ -->
  <div id="screen-home" class="screen">
    <div class="home-topbar">
      <div class="header-leading">
        <button class="app-menu-btn" type="button" data-open-drawer aria-label="Open menu">&#9776;</button>
        <div class="home-brand">
          <div class="mark">O</div>
          <span class="brand-name">Orion</span>
        </div>
      </div>
      <div class="conn-badge offline" id="conn-badge">
        <span class="conn-dot"></span>
        <span id="conn-text">${machineName ? 'Connecting to ' + machineName + '…' : 'Connecting'}</span>
      </div>
    </div>

    <div class="home-body" id="home-body">
      <!-- Dispatch and registered specialist mode toggle -->
      <div class="mode-toggle-row" id="mode-toggle-row">
        <button type="button" class="mode-toggle-btn" id="mode-toggle-dispatch" data-mode="orion">Dispatch</button>
${specialistModeButtons}
      </div>

      <!-- Search + New Chat -->
      <div class="home-search-row">
        <div class="home-search-wrap">
          <span class="home-search-icon">&#x2315;</span>
          <input type="search" id="home-search" placeholder="Search history..." autocomplete="off">
        </div>
        <button class="new-chat-pill" id="home-new-chat" type="button">+ New</button>
      </div>

      <!-- Projects -->
      <div class="home-section" id="home-projects-section" style="display:none;">
        <div class="home-section-title">Projects</div>
        <div class="home-projects" id="home-projects"></div>
      </div>

      <div id="home-approvals-section"></div>

      <!-- Recent Chats -->
      <div class="home-section">
        <div class="home-section-heading">
          <div class="home-section-title" id="home-recents-title">Recent Chats</div>
          <button class="home-clear-project" id="home-clear-project" type="button">All</button>
        </div>
        <div class="home-recents" id="home-recents">
          <div class="home-empty">No recent chats yet.</div>
        </div>
      </div>
    </div>

    <div class="install-tip" id="install-tip"></div>
  </div>

  <!-- Project detail screen -->
  <div id="screen-project" class="screen">
    <div class="new-chat-header">
      <button class="app-menu-btn" type="button" data-open-drawer aria-label="Open menu">&#9776;</button>
      <button class="back-btn" id="project-back">&#x2190;</button>
      <span class="new-chat-header-title" id="project-screen-heading">Project</span>
    </div>
    <div class="project-screen-body">
      <div class="project-summary">
        <div class="project-summary-main">
          <div class="project-summary-title" id="project-screen-title">Project</div>
          <div class="project-summary-path" id="project-screen-path"></div>
          <div class="project-summary-meta" id="project-screen-meta"></div>
        </div>
        <button class="new-chat-pill" id="project-new-chat" type="button">+ New</button>
      </div>
      <div id="project-approvals-section"></div>
      <div class="home-section-title">Chats</div>
      <div class="project-thread-list" id="project-thread-list">
        <div class="home-empty">No chats in this project yet.</div>
      </div>
    </div>
  </div>

  <!-- ═══ NEW CHAT SCREEN ════════════════════════════ -->
  <div id="screen-new-chat" class="screen">
    <div class="new-chat-header">
      <button class="app-menu-btn" type="button" data-open-drawer aria-label="Open menu">&#9776;</button>
      <button class="back-btn" id="new-chat-back">&#x2190;</button>
      <span class="new-chat-header-title">New Chat</span>
    </div>

    <div class="new-chat-body">
      <div class="dispatch-chat-intro" id="dispatch-chat-intro">
        <div class="dispatch-chat-title">No task is too large.</div>
        <div class="dispatch-chat-copy">Tell Orion what we're taking on.</div>
      </div>
      <div class="coder-workspace-picker" id="coder-workspace-picker">
        <div class="lets-work-label">Let's work on</div>
        <button class="proj-selector-btn" id="proj-selector-btn" type="button">
          <span class="proj-selector-icon">&#x1F4C1;</span>
          <span class="proj-selector-name" id="proj-selector-name">Standalone</span>
          <span class="proj-selector-chevron">&#x2304;</span>
        </button>
      </div>
    </div>

    <div class="new-chat-composer-area">
      <div class="new-chat-composer">
        <textarea id="new-chat-prompt" placeholder="Ask Orion anything..." autocomplete="off" rows="1"></textarea>
        <button class="send-button" id="new-chat-send" type="button" aria-label="Send"></button>
      </div>
    </div>
  </div>

  <!-- Project picker overlay (for new-chat screen) -->
  <div class="proj-picker-overlay" id="proj-picker-overlay">
    <div class="proj-picker-sheet">
      <div class="proj-picker-handle"></div>
      <div class="proj-picker-title">Choose a project</div>
      <div class="proj-picker-list" id="proj-picker-list"></div>
    </div>
  </div>

  <div class="dispatch-sheet-overlay" id="dispatch-browser-overlay" role="dialog" aria-modal="true" aria-labelledby="dispatch-browser-title">
    <section class="dispatch-sheet">
      <div class="dispatch-sheet-handle"></div>
      <div class="dispatch-sheet-head">
        <div>
          <div class="dispatch-sheet-title" id="dispatch-browser-title">Discussions</div>
          <div class="dispatch-sheet-copy">Your Dispatch history, newest first.</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="dispatch-browser-new-chat" type="button" style="padding:6px 14px;border-radius:20px;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:0.82rem;font-weight:600;cursor:pointer;white-space:nowrap;">+ New Chat</button>
          <button class="dispatch-sheet-close" id="dispatch-browser-close" type="button" aria-label="Close browser">&#x2715;</button>
        </div>
      </div>
      <label class="dispatch-browser-search">
        <span aria-hidden="true">&#x2315;</span>
        <input id="dispatch-browser-search" type="search" placeholder="Search discussions" autocomplete="off">
      </label>
      <div class="dispatch-browser-content" id="dispatch-browser-content"></div>
    </section>
  </div>

  <div class="dispatch-sheet-overlay" id="dispatch-project-overlay" role="dialog" aria-modal="true" aria-labelledby="dispatch-project-title">
    <section class="dispatch-sheet dispatch-project-sheet">
      <div class="dispatch-sheet-handle"></div>
      <div class="dispatch-sheet-head">
        <div>
          <div class="dispatch-sheet-title" id="dispatch-project-title">Project</div>
          <div class="dispatch-sheet-copy" id="dispatch-project-summary"></div>
        </div>
        <button class="dispatch-sheet-close" id="dispatch-project-close" type="button" aria-label="Close project">&#x2715;</button>
      </div>
      <div class="dispatch-project-actions">
        <button id="dispatch-project-continue" class="dispatch-project-primary" type="button">Continue latest conversation</button>
        <button id="dispatch-project-fresh" class="dispatch-project-secondary" type="button">Start fresh with project context</button>
      </div>
      <div class="dispatch-browser-section-label">Recent discussions</div>
      <div class="dispatch-project-discussions" id="dispatch-project-discussions"></div>
    </section>
  </div>

  <div id="screen-settings" class="screen">
    <div class="new-chat-header">
      <button class="app-menu-btn" type="button" data-open-drawer aria-label="Open menu">&#9776;</button>
      <button class="back-btn" id="settings-back">&#x2190;</button>
      <span class="new-chat-header-title">Settings</span>
    </div>
    <div class="settings-body">
      <section class="settings-card">
        <div>
          <div class="settings-card-title">Updates</div>
          <div class="settings-card-copy">Check local Orion files and restart into the current build.</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="settings-row-title">Local files</div>
            <div class="settings-row-meta" id="update-check-status">Checking for updates...</div>
          </div>
        </div>
        <div class="settings-actions">
          <button id="update-check-now-btn" type="button" class="btn-sm">Check Now</button>
          <button id="restart-app-btn" type="button" class="btn-sm">Restart</button>
        </div>
        <div class="update-banner" id="update-banner">
          <span class="update-banner-text" id="update-banner-text">Update available</span>
          <button class="update-apply-btn" id="update-apply-btn" type="button">Update &amp; Restart</button>
        </div>
      </section>
      <section class="settings-card">
        <div>
          <div class="settings-card-title">Notifications</div>
          <div class="settings-card-copy">Let the phone notify you when Orion finishes work.</div>
        </div>
        <div class="update-banner" id="notif-banner" style="background:rgba(99,102,241,0.08); border-color:rgba(99,102,241,0.25); color:#a5b4fc;">
          <span class="update-banner-text" id="notif-banner-text">Get notified when tasks finish</span>
          <button class="update-apply-btn" id="notif-enable-btn" type="button" style="background:#6366f1;">Enable</button>
        </div>
      </section>
      <section class="settings-card">
        <div class="settings-card-title">Build</div>
        <div class="settings-card-copy" id="settings-build-meta">Phone companion ${COMPANION_CLIENT_BUILD}</div>
      </section>
    </div>
  </div>

  <div class="phone-confirm-overlay" id="phone-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="phone-confirm-title">
    <div class="phone-confirm-card">
      <div class="phone-confirm-title" id="phone-confirm-title">Delete chat?</div>
      <div class="phone-confirm-message" id="phone-confirm-message">This cannot be undone.</div>
      <div class="phone-confirm-actions">
        <button class="phone-confirm-btn" id="phone-confirm-cancel" type="button">Cancel</button>
        <button class="phone-confirm-btn danger" id="phone-confirm-delete" type="button">Delete</button>
      </div>
    </div>
  </div>

  <!-- ═══ MAIN SCREEN (Tab Layout) ══════════════════ -->
  <div class="image-lightbox" id="image-lightbox" role="dialog" aria-modal="true" aria-labelledby="image-lightbox-title">
    <div class="image-lightbox-header">
      <div class="image-lightbox-title" id="image-lightbox-title">Chat image</div>
      <button class="image-lightbox-button" id="image-lightbox-close" type="button" aria-label="Close image">&times;</button>
    </div>
    <div class="image-lightbox-viewport" id="image-lightbox-viewport">
      <img class="image-lightbox-image" id="image-lightbox-image" alt="Expanded chat image">
    </div>
    <div class="image-lightbox-controls" aria-label="Image zoom controls">
      <button class="image-lightbox-button" id="image-lightbox-zoom-out" type="button" aria-label="Zoom out">&minus;</button>
      <button class="image-lightbox-button" id="image-lightbox-fit" type="button">Fit</button>
      <span class="image-lightbox-zoom" id="image-lightbox-zoom">100%</span>
      <button class="image-lightbox-button" id="image-lightbox-zoom-in" type="button" aria-label="Zoom in">+</button>
    </div>
  </div>

  <div id="screen-main" class="screen active">
    <header class="app-header">
      <button class="app-menu-btn" type="button" data-open-drawer aria-label="Open menu">&#9776;</button>
      <button class="back-btn" id="main-back">&#x2190;</button>
      <div class="chat-header-center">
        <span class="chat-proj-name" id="chat-proj-name">Orion</span>
      </div>
      <button class="dispatch-browse-button" id="dispatch-browse-button" type="button" aria-label="Browse Dispatch discussions" title="Browse discussions">&#x2315;</button>
      <div class="status-pill connecting" id="status-pill">Connecting</div>
    </header>

    <div class="tab-panels">
      <!-- ── Chat tab ─────────────────────────────── -->
      <div class="tab-panel active" id="panel-chat">
        <div class="messages" id="messages">
          <div class="dispatch-landing"><div class="dispatch-landing-intro"><div class="dispatch-landing-title">Orion is ready.</div><div class="dispatch-landing-copy">No task is too large. What are we taking on?</div></div></div>
        </div>
        <button class="dispatch-running-banner" id="dispatch-running-banner" type="button">
          <span class="dispatch-running-dot"></span>
          <span class="dispatch-running-text" id="dispatch-running-text">Coder is working</span>
        </button>
        <section class="plan-panel" id="plan-panel">
          <div class="plan-title">Plan waiting for approval</div>
          <div class="plan-copy">Review the latest plan in chat. Start it here when ready.</div>
          <button class="approve-button" id="approve-plan" type="button">Start Implementation</button>
          <div class="control-row">
            <button id="deny-plan" type="button" class="ctrl-btn">Deny</button>
            <button id="revise-plan" type="button" class="ctrl-btn">Revise</button>
          </div>
        </section>
        <div class="composer-area">
          <div class="quick-chips">
            <button class="chip" id="chip-stop" type="button">&#x23F9; Stop</button>
            <button class="chip" id="chip-new-task" type="button">&#x1F504; New Focus</button>
            <button class="chip" id="chip-copy-last" type="button">&#x1F4CB; Copy Last</button>
          </div>
          <div class="form-mode-bar" id="form-mode-bar">
            <span class="mode-icon">&#x25B6;</span>
            <span class="mode-label" id="form-mode-label">Steering</span>
            <button class="mode-cancel" id="form-mode-cancel" type="button">Cancel</button>
          </div>
          <!-- Hidden file inputs for the attach sheet -->
          <input type="file" id="phone-img-camera"  accept="image/*" capture="environment" style="display:none" aria-hidden="true" tabindex="-1">
          <input type="file" id="phone-img-gallery" accept="image/*" style="display:none" aria-hidden="true" tabindex="-1">
          <input type="file" id="phone-file-input"  accept=".txt,.md,.csv,.json,.js,.ts,.jsx,.tsx,.py,.html,.css,.sh,.yml,.yaml,.xml,.log,.sql,.toml,.ini,.env" style="display:none" aria-hidden="true" tabindex="-1">
          <!-- Attach picker sheet -->
          <div class="attach-sheet-overlay" id="attach-sheet-overlay">
            <div class="attach-sheet">
              <div class="attach-sheet-title">Attach</div>
              <button class="attach-sheet-btn" id="sheet-camera-btn" type="button"><span class="asi">&#128247;</span><span>Take Photo</span></button>
              <button class="attach-sheet-btn" id="sheet-gallery-btn" type="button"><span class="asi">&#128444;</span><span>Choose from Gallery</span></button>
              <button class="attach-sheet-btn" id="sheet-file-btn" type="button"><span class="asi">&#128206;</span><span>Attach File</span></button>
              <button class="attach-sheet-cancel" id="attach-sheet-cancel" type="button">Cancel</button>
            </div>
          </div>
          <div class="phone-img-preview" id="phone-img-preview" style="display:none">
            <img id="phone-img-thumb" src="" alt="attached image">
            <button class="phone-img-remove" id="phone-img-remove" type="button" aria-label="Remove image">&#x2715;</button>
          </div>
          <div class="phone-file-preview" id="phone-file-preview" style="display:none">
            <div class="phone-file-chip"><span>&#128206;</span><span id="phone-file-name"></span></div>
            <button class="phone-img-remove" id="phone-file-remove" type="button" aria-label="Remove file">&#x2715;</button>
          </div>
          <div class="composer-model-bar">
            <select id="composer-model-select" aria-label="Model for the next answer"><option value="">Model&#8230;</option></select>
            <select id="composer-reasoning-select" aria-label="Reasoning depth for the next answer"><option value="auto">&#129504; Auto</option></select>
          </div>
          <form id="prompt-form">
            <div class="composer">
              <button class="attach-image-btn" id="attach-image-btn" type="button" aria-label="Attach" title="Attach photo or file">&#128206;</button>
              <textarea id="prompt" placeholder="Ask Orion..." autocomplete="off" rows="1"></textarea>
              <button class="send-button" id="send" type="button" aria-label="Send"></button>
            </div>
          </form>
        </div>
      </div>

      <!-- ── Status tab ─────────────────────────────── -->
      <div class="tab-panel" id="panel-status">
        <div id="global-indicator-banner" class="indicator-banner idle">
          <span>Agent is currently idle</span>
        </div>
        <div class="section-header">
          <div class="section-title">Current Task</div>
          <span class="badge muted" id="project-count-badge">0 Projects</span>
          <button id="new-task" type="button" class="btn-sm">+ New</button>
        </div>
        <div id="active-task-container" class="status-card active-card">
          <div class="empty">Loading...</div>
        </div>
        <div class="status-card info-card">
          <div class="info-row"><span class="info-label">Model</span><select class="info-model-select" id="model-select-phone"><option value="">—</option></select></div>
          <div class="info-row"><span class="info-label">Status</span><span class="info-value" id="status">—</span></div>
          <div class="info-row"><span class="info-label">Workspace</span><span class="info-value" id="meta">Connecting...</span></div>
        </div>
        <div class="ctx-controls-running" id="ctx-controls-running">
          <div class="control-row">
            <button id="steer-task" type="button" class="ctrl-btn">&#x276F; Steer</button>
            <button id="stop-task" type="button" class="ctrl-btn">&#x23F8; Pause</button>
          </div>
        </div>
        <div class="ctx-controls-idle" id="ctx-controls-idle">
          <div class="control-row">
            <button id="resume-task" type="button" class="ctrl-btn">&#x25B6; Resume</button>
            <button id="refresh-state" type="button" class="ctrl-btn">&#x21BB; Refresh</button>
          </div>
        </div>
        <div id="task-list-card" class="status-card task-list-card">
          <div class="card-header">
            <div class="section-title">Task List</div>
            <span class="badge muted" id="task-list-progress">0%</span>
          </div>
          <div id="phone-task-list" class="phone-task-list"></div>
        </div>
        <div id="attention-tasks-container"></div>
        <div id="queued-prompts-container" class="status-card" style="display:none;"></div>
        <!-- Hidden compat elements -->
        <div style="display:none;">
          <select id="project-select"><option value="">Standalone conversation</option></select>
          <button id="new-task-dup"></button>
          <div id="recent-tasks-list"></div>
          <div id="queue-line"></div>
          <div id="latest-output"></div>
          <div id="preview-panel"></div>
          <div id="tasks"></div>
        </div>
      </div>

      <!-- ── Logs tab ──────────────────────────────── -->
      <div class="tab-panel" id="panel-logs">
        <div class="logs-sub-tabs">
          <button class="log-tab-btn active" data-tab="tab-output">Output</button>
          <button class="log-tab-btn" data-tab="tab-walkthrough">Walkthrough</button>
          <button class="log-tab-btn" data-tab="tab-files">Files</button>
          <button class="log-tab-btn" data-tab="tab-tests">Tests</button>
          <button class="log-tab-btn" data-tab="tab-launch">Launch</button>
        </div>
        <div class="logs-content">
          <div id="tab-output" class="tab-pane active">Latest output will appear here.</div>
          <div id="tab-walkthrough" class="tab-pane">No walkthrough yet.</div>
          <div id="tab-files" class="tab-pane">No changed files.</div>
          <div id="tab-tests" class="tab-pane">No test results.</div>
          <div id="tab-launch" class="tab-pane">
            <div id="launch-url-container" style="margin-bottom:8px;font-weight:600;">No app launch URL recorded.</div>
            <pre id="launch-logs-container" class="terminal-logs">No launch logs yet.</pre>
          </div>
        </div>
      </div>
    </div><!-- /tab-panels -->

    <nav class="bottom-nav">
      <button class="nav-btn active" data-panel="panel-chat">
        <span class="nav-icon">&#x1F4AC;</span>
        <span class="nav-label">Chat</span>
      </button>
      <button class="nav-btn" data-panel="panel-status">
        <span class="nav-icon">&#x1F4CA;</span>
        <span class="nav-label">Status</span>
      </button>
      <button class="nav-btn" data-panel="panel-logs">
        <span class="nav-icon">&#x1F4CB;</span>
        <span class="nav-label">Logs</span>
      </button>
    </nav>
  </div><!-- /screen-main -->

</div><!-- /app-root -->

<!-- New Task Bottom Sheet -->
<div class="sheet-overlay" id="sheet-overlay"></div>
<div class="new-task-sheet" id="new-task-sheet">
  <div class="sheet-handle"></div>
  <div class="sheet-header">
    <div class="sheet-title">New Task</div>
    <button class="sheet-close-btn" id="sheet-close" type="button">&#x2715;</button>
  </div>
  <div class="sheet-section">
    <div class="sheet-label">Select a project</div>
    <div class="proj-grid" id="proj-grid">
      <div class="proj-tile standalone selected" data-path="">
        <div class="proj-tile-name">&#x2726; Standalone</div>
        <div class="proj-tile-meta">No project workspace</div>
      </div>
    </div>
  </div>
  <div class="sheet-section">
    <div class="sheet-label">Initial prompt <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted);">(optional)</span></div>
    <textarea class="sheet-textarea" id="sheet-prompt" placeholder="What should Orion build or work on?" rows="3"></textarea>
    <button class="sheet-start-btn" id="sheet-start" type="button">Start Task</button>
  </div>
</div>
<div id="__dbg" style="display:none;position:fixed;top:0;left:0;right:0;z-index:99999;background:#7f1d1d;color:#fff;padding:8px 12px;font-size:12px;font-weight:700;word-break:break-word;" onclick="this.style.display='none'"></div>

<script>
  // ── Diagnostics (remove after debugging) ─────────
  window.__dbgErrors = [];
  window.onerror = function(msg, src, line) {
    window.__dbgErrors.push(line + ': ' + msg);
    var el = document.getElementById('__dbg');
    if (el) { el.style.display = 'block'; el.textContent = 'ERR ' + line + ': ' + msg; }
  };
  window.addEventListener('unhandledrejection', function(e) {
    var el = document.getElementById('__dbg');
    if (el) { el.style.display = 'block'; el.textContent = 'PROMISE ERR: ' + (e.reason && e.reason.message || e.reason); }
  });

  // ── Keyboard-aware viewport ────────────────────────
  // Strategy: use interactive-widget=resizes-content (Chrome 108+) in the viewport
  // meta so the layout viewport shrinks when the keyboard opens. As a belt-and-suspenders
  // fallback, also track window.innerHeight (reliable on Android Chrome) and
  // visualViewport.height (reliable on iOS Safari) and use whichever is smaller.
  const applyViewportHeight = () => {
    const h = window.visualViewport
      ? Math.min(window.innerHeight, window.visualViewport.height)
      : window.innerHeight;
    document.documentElement.style.setProperty('--app-vvh', h + 'px');
  };
  window.addEventListener('resize', applyViewportHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', applyViewportHeight);
    window.visualViewport.addEventListener('scroll', applyViewportHeight);
  }
  applyViewportHeight();

  const machineName = ${JSON.stringify(machineName || 'Desktop')};
  const companionBuild = ${JSON.stringify(COMPANION_CLIENT_BUILD)};
  const companionSpecialistDefinitions = Object.freeze(${JSON.stringify(COMPANION_SPECIALISTS)});
  const companionSpecialistByRole = new Map(companionSpecialistDefinitions.map(definition => [definition.role, definition]));
  const sessionKey = 'orionPhoneCompanionSession';
  const RECENT_WS_KEY = 'orionRecentWorkspaces';
  const initialUrlParams = new URLSearchParams(location.search);
  const resetRequested = initialUrlParams.get('reset') === '1';
  let pendingNotificationConversationId = initialUrlParams.get('conversation') || '';
  let serviceWorkerRefresh = Promise.resolve();
  try {
    document.documentElement.dataset.companionBuild = companionBuild;
    const previousBuild = localStorage.getItem('orionCompanionBuild') || '';
    if (resetRequested) {
      localStorage.removeItem(sessionKey);
    }
    if (resetRequested || previousBuild !== companionBuild) {
      localStorage.setItem('orionCompanionBuild', companionBuild);
      if ('serviceWorker' in navigator) serviceWorkerRefresh = navigator.serviceWorker.getRegistrations()
        .then(regs => Promise.all(regs.map(reg => reg.unregister())))
        .catch(() => {});
    }
  } catch (e) {}
  let deviceSession = null;
  try { deviceSession = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch (e) { deviceSession = null; }
  let confirmedCredentialFailures = 0;
  const permanentCredentialFailureCodes = new Set([
    'COMPANION_DEVICE_UNKNOWN',
    'COMPANION_DEVICE_REVOKED',
    'COMPANION_DEVICE_NOT_APPROVED',
    'COMPANION_CREDENTIAL_INVALID'
  ]);

  // ── DOM refs ─────────────────────────────────────
  const messagesEl               = document.getElementById('messages');
  const metaEl                   = document.getElementById('meta');
  const modelEl                  = document.getElementById('model'); // kept for compat; may be null now
  const phoneModelSelect         = document.getElementById('model-select-phone');
  const composerModelSelect      = document.getElementById('composer-model-select');
  const composerReasoningSelect  = document.getElementById('composer-reasoning-select');
  const statusEl                 = document.getElementById('status');
  const statusPillEl             = document.getElementById('status-pill');
  const reconnectBannerEl        = document.getElementById('reconnect-banner');
  const planPanelEl              = document.getElementById('plan-panel');
  const approvePlanEl            = document.getElementById('approve-plan');
  const denyPlanEl               = document.getElementById('deny-plan');
  const revisePlanEl             = document.getElementById('revise-plan');
  const refreshStateEl           = document.getElementById('refresh-state');
  const stopTaskEl               = document.getElementById('stop-task');
  const resumeTaskEl             = document.getElementById('resume-task');
  const newTaskEl                = document.getElementById('new-task');
  const newFocusChipEl           = document.getElementById('chip-new-task');
  const steerTaskEl              = document.getElementById('steer-task');
  const projectSelectEl          = document.getElementById('project-select');
  const projectCountBadgeEl      = document.getElementById('project-count-badge');
  const globalIndicatorBanner    = document.getElementById('global-indicator-banner');
  const activeTaskContainer      = document.getElementById('active-task-container');
  const attentionTasksContainer  = document.getElementById('attention-tasks-container');
  const queuedPromptsContainer   = document.getElementById('queued-prompts-container');
  const recentTasksList          = document.getElementById('recent-tasks-list');
  const taskListCard             = document.getElementById('task-list-card');
  const taskListProgress         = document.getElementById('task-list-progress');
  const phoneTaskList            = document.getElementById('phone-task-list');
  const installTipEl             = document.getElementById('install-tip');
  const appDrawerOverlay         = document.getElementById('app-drawer-overlay');
  const appDrawerClose           = document.getElementById('app-drawer-close');
  const drawerMeta               = document.getElementById('drawer-meta');
  const settingsBackEl           = document.getElementById('settings-back');
  const form                     = document.getElementById('prompt-form');
  const promptEl                 = document.getElementById('prompt');
  const formModeBar              = document.getElementById('form-mode-bar');
  const formModeLabel            = document.getElementById('form-mode-label');
  const formModeCancel           = document.getElementById('form-mode-cancel');
  const sheetOverlay             = document.getElementById('sheet-overlay');
  const newTaskSheet             = document.getElementById('new-task-sheet');
  const sheetClose               = document.getElementById('sheet-close');
  const projGrid                 = document.getElementById('proj-grid');
  const sheetPrompt              = document.getElementById('sheet-prompt');
  const sheetStart               = document.getElementById('sheet-start');
  const ctxRunning               = document.getElementById('ctx-controls-running');
  const ctxIdle                  = document.getElementById('ctx-controls-idle');
  const dispatchRunningBanner    = document.getElementById('dispatch-running-banner');
  const dispatchRunningText      = document.getElementById('dispatch-running-text');
  const dispatchBrowseButton     = document.getElementById('dispatch-browse-button');
  const dispatchBrowserOverlay   = document.getElementById('dispatch-browser-overlay');
  const dispatchBrowserClose     = document.getElementById('dispatch-browser-close');
  const dispatchBrowserSearch    = document.getElementById('dispatch-browser-search');
  const dispatchBrowserContent   = document.getElementById('dispatch-browser-content');
  const dispatchProjectOverlay   = document.getElementById('dispatch-project-overlay');
  const dispatchProjectClose     = document.getElementById('dispatch-project-close');
  const dispatchProjectTitle     = document.getElementById('dispatch-project-title');
  const dispatchProjectSummary   = document.getElementById('dispatch-project-summary');
  const dispatchProjectContinue  = document.getElementById('dispatch-project-continue');
  const dispatchProjectFresh     = document.getElementById('dispatch-project-fresh');
  const dispatchProjectThreads   = document.getElementById('dispatch-project-discussions');
  const chatProjNameEl           = document.getElementById('chat-proj-name');
  const connBadgeEl              = document.getElementById('conn-badge');
  const connTextEl               = document.getElementById('conn-text');
  const homeBodyEl               = document.getElementById('home-body');
  const homeProjectsSection      = document.getElementById('home-projects-section');
  const homeProjectsEl           = document.getElementById('home-projects');
  const homeApprovalsSection     = document.getElementById('home-approvals-section');
  const homeRecentsEl            = document.getElementById('home-recents');
  const homeRecentsTitleEl       = document.getElementById('home-recents-title');
  const homeClearProjectEl       = document.getElementById('home-clear-project');
  const homeSearchEl             = document.getElementById('home-search');
  const modeToggleButtons        = document.querySelectorAll('#mode-toggle-row [data-mode]');
  const projectBackEl            = document.getElementById('project-back');
  const projectNewChatEl         = document.getElementById('project-new-chat');
  const projectScreenHeadingEl   = document.getElementById('project-screen-heading');
  const projectScreenTitleEl     = document.getElementById('project-screen-title');
  const projectScreenPathEl      = document.getElementById('project-screen-path');
  const projectScreenMetaEl      = document.getElementById('project-screen-meta');
  const projectApprovalsSection  = document.getElementById('project-approvals-section');
  const projectThreadListEl      = document.getElementById('project-thread-list');
  const projectScreenBodyEl      = document.querySelector('#screen-project .project-screen-body');
  const newChatScreenEl          = document.getElementById('screen-new-chat');
  const newChatPromptEl          = document.getElementById('new-chat-prompt');
  const projSelectorBtn          = document.getElementById('proj-selector-btn');
  const projSelectorNameEl       = document.getElementById('proj-selector-name');
  const projPickerOverlay        = document.getElementById('proj-picker-overlay');
  const projPickerList           = document.getElementById('proj-picker-list');
  const phoneConfirmOverlay      = document.getElementById('phone-confirm-overlay');
  const phoneConfirmTitle        = document.getElementById('phone-confirm-title');
  const phoneConfirmMessage      = document.getElementById('phone-confirm-message');
  const phoneConfirmCancel       = document.getElementById('phone-confirm-cancel');
  const phoneConfirmDelete       = document.getElementById('phone-confirm-delete');

  let lastSignature = '';
  let lastHomeSignature = '';
  let lastProjectScreenSignature = '';
  let lastDispatchLandingSignature = '';
  let lastLoadedState = null;
  // Clarification answers are user-owned draft state. The transcript is rebuilt whenever live
  // task/status data changes, so keeping selections only in radio-button DOM nodes caused polling
  // to silently erase answers before Submit was tapped. Retain a small conversation/question-bound
  // draft outside the disposable transcript DOM and restore it after every render.
  const clarificationDrafts = new Map();
  // ── Chat scroll ownership ─────────────────────────
  // The message list is rebuilt via innerHTML on every state update, and while a task streams
  // those updates land every second or faster. A DOM rebuild destroys any in-progress touch
  // drag / momentum fling, so if we rebuild while the user's finger is on the screen they can
  // literally never escape the bottom: they drag up 50px, a render fires, the gesture dies
  // inside the 80px "near bottom" zone, and the next render snaps them back down. The rule is
  // therefore: WE only own the scroll position while the user is pinned to the bottom and not
  // touching. The moment they touch or scroll up, the DOM is theirs — renders are deferred
  // (stashed in pendingRenderState) and applied only when they return to the bottom and lift
  // their finger. Conversation switches still render immediately (handled in the renderer).
  let userPinnedToBottom = true;
  let touchActive = false;
  let pendingRenderState = null;
  const NEAR_BOTTOM_PX = 80;

  // "Is the pane genuinely showing the loading placeholder?" must be a STRUCTURAL check of the
  // placeholder element -- never a substring test over the whole transcript. A regex like
  // /Loading conversation/i over messagesEl.textContent matches inside ordinary chat content
  // (e.g. a message discussing a "Lazy Loading Conversations Implementation Plan"), which made
  // the emergency-fill path believe the pane was stuck loading forever: it force-re-rendered and
  // force-scrolled to the bottom every 1.2s, bypassing every scroll guard, in precisely the
  // conversations where Jason discusses Orion's own code.
  function isShowingLoadingPlaceholder() {
    if (!messagesEl || messagesEl.children.length !== 1) return false;
    const only = messagesEl.firstElementChild;
    return only.classList.contains('empty') && /^\s*Loading conversation/i.test(only.textContent || '');
  }

  function applyPendingRenderIfSafe() {
    if (!pendingRenderState || touchActive || !userPinnedToBottom) return;
    const state = pendingRenderState;
    pendingRenderState = null;
    renderConversationMessages(state);
  }

  if (messagesEl) {
    messagesEl.addEventListener('scroll', () => {
      const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
      userPinnedToBottom = distanceFromBottom < NEAR_BOTTOM_PX;
      // Returning to the bottom (e.g. momentum fling down) releases any deferred render.
      if (userPinnedToBottom && !touchActive) applyPendingRenderIfSafe();
    }, { passive: true });
    messagesEl.addEventListener('touchstart', () => { touchActive = true; }, { passive: true });
    messagesEl.addEventListener('touchend', () => {
      // Small grace period so a momentum fling that's still settling isn't interrupted by an
      // immediately-applied render; the scroll listener above also releases once settled.
      setTimeout(() => { touchActive = false; applyPendingRenderIfSafe(); }, 250);
    }, { passive: true });
    messagesEl.addEventListener('touchcancel', () => {
      setTimeout(() => { touchActive = false; applyPendingRenderIfSafe(); }, 250);
    }, { passive: true });
  }
  let phoneImageData = null;
  let phoneImageMimeType = null;
  let phoneFileContent = null;
  let phoneFileName = null;
  let lastProjectOptionsSignature = '';
  let currentConversationId = '';
  let formMode = 'prompt';
  let formTargetConversationId = '';
  let availableProjects = [];
  let selectedSheetProject = '';
  let newChatSelectedProject = '';
  let projectDetailPath = '';
  let currentScreen = 'screen-main';
  let allConversations = [];
  let initialScreenResolved = false;
  let dispatchDraftActive = true;
  let dispatchDraftProjectPath = '';
  let dispatchDraftContextSummary = '';
  let lastDispatchConversationId = '';
  let selectedDispatchProjectPath = '';
  let promptSubmitInFlight = false; // guard against double-submit on mobile
  // Dispatch, Coder, and Operator keep separate conversation histories on mobile too. This is a
  // client-side view filter, independent of whichever conversation is open. Every fresh app
  // launch still starts at Dispatch's front door; specialist choices persist for this page session.
  let companionMode = 'orion';
  let activeConversationMode = companionMode;
  let stateRequestSerial = 0;
  let acceptedConversationSelectionRevision = 0;
  let pendingConversationSelectionId = '';
  let consecutiveStateFailures = 0;
  let lastSseMessageAt = 0;
  let lastSseActivityAt = 0;
  let lastStatePayloadAt = 0;
  let sseStateReceived = false;
  let sseConnected = false;
  const PHONE_STATE_FRESHNESS_MS = 8000;
  let stateFetchController = null;
  let stateFetchGeneration = 0;
  let optimisticPhoneSend = null;
  let restartPending = false; // set when the user triggers a restart/update; cleared on reconnect
  let phoneConfirmResolver = null;
  let phoneConfirmPreviousFocus = null;

  function showPhoneConfirmDialog({ title, message, confirmLabel = 'Delete' }) {
    return new Promise(resolve => {
      if (phoneConfirmResolver) closePhoneConfirmDialog(false);
      phoneConfirmResolver = resolve;
      phoneConfirmPreviousFocus = document.activeElement;
      phoneConfirmTitle.textContent = title || 'Confirm action';
      phoneConfirmMessage.textContent = message || 'This action cannot be undone.';
      phoneConfirmDelete.textContent = confirmLabel;
      phoneConfirmOverlay.classList.add('visible');
      phoneConfirmCancel.focus();
    });
  }

  function closePhoneConfirmDialog(confirmed) {
    phoneConfirmOverlay.classList.remove('visible');
    const resolver = phoneConfirmResolver;
    const previousFocus = phoneConfirmPreviousFocus;
    phoneConfirmResolver = null;
    phoneConfirmPreviousFocus = null;
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    if (resolver) resolver(!!confirmed);
  }

  phoneConfirmCancel.addEventListener('click', () => closePhoneConfirmDialog(false));
  phoneConfirmDelete.addEventListener('click', () => closePhoneConfirmDialog(true));
  phoneConfirmOverlay.addEventListener('click', event => {
    if (event.target === phoneConfirmOverlay) closePhoneConfirmDialog(false);
  });
  document.addEventListener('keydown', event => {
    if (!phoneConfirmOverlay.classList.contains('visible')) return;
    if (event.key === 'Escape') {
      closePhoneConfirmDialog(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [phoneConfirmCancel, phoneConfirmDelete].filter(button => !button.disabled);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // ── Recent workspaces (localStorage) ─────────────
  function getRecentWorkspaces() {
    try { return JSON.parse(localStorage.getItem(RECENT_WS_KEY) || '[]'); } catch { return []; }
  }
  function projectNameFromPath(projectPath, fallback = 'Standalone') {
    let normalized = String(projectPath || '').replace(/\\\\/g, '/');
    while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized.split('/').pop() || fallback;
  }
  function trackWorkspace(wsPath, name) {
    if (!wsPath) return;
    const list = getRecentWorkspaces().filter(w => w.path !== wsPath);
    list.unshift({ path: wsPath, name: name || projectNameFromPath(wsPath, wsPath), lastSeen: Date.now() });
    localStorage.setItem(RECENT_WS_KEY, JSON.stringify(list.slice(0, 10)));
  }
  function relativeTime(ts) {
    if (!ts) return '';
    const d = Date.now() - new Date(ts).getTime();
    const m = Math.floor(d / 60000), h = Math.floor(d / 3600000), day = Math.floor(d / 86400000), w = Math.floor(d / 604800000);
    if (m < 2) return 'just now';
    if (m < 60) return m + 'm';
    if (h < 24) return h + 'h';
    if (day < 7) return day + 'd';
    return w + 'w';
  }

  function normalizeCompanionMode(mode) {
    const normalized = String(mode || '').trim().toLowerCase();
    return normalized === 'orion' || companionSpecialistByRole.has(normalized) ? normalized : 'orion';
  }

  function companionSpecialistDefinition(mode) {
    return companionSpecialistByRole.get(normalizeCompanionMode(mode)) || null;
  }

  function isCompanionSpecialistMode(mode) {
    return !!companionSpecialistDefinition(mode);
  }

  function dispatchGreeting() {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'Good morning' : (hour < 17 ? 'Good afternoon' : 'Good evening');
    return timeOfDay + ', Jason.';
  }

  function restoreScrollTop(element, previousScrollTop) {
    if (!element) return;
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = Math.min(previousScrollTop, maxScrollTop);
  }

  // ── Screen management ─────────────────────────────
  function showScreen(id) {
    currentScreen = id;
    if (id === 'screen-new-chat') updateNewChatModeUI();
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }

  function updateNewChatModeUI() {
    const isDispatchStart = companionMode === 'orion' && !newChatSelectedProject;
    const specialist = companionSpecialistDefinition(companionMode);
    const isOperatorStart = !!(specialist && specialist.canControlDesktop);
    const isResearcherStart = !!(specialist && !specialist.canControlDesktop && !specialist.canEditWorkspace);
    if (newChatScreenEl) {
      newChatScreenEl.classList.toggle('dispatch-mode', isDispatchStart);
      newChatScreenEl.classList.toggle('operator-mode', isOperatorStart);
      newChatScreenEl.classList.toggle('researcher-mode', isResearcherStart);
      newChatScreenEl.classList.toggle('coder-mode', !!(specialist && specialist.canEditWorkspace));
    }
    const introTitle = document.querySelector('#dispatch-chat-intro .dispatch-chat-title');
    const introCopy = document.querySelector('#dispatch-chat-intro .dispatch-chat-copy');
    if (introTitle) introTitle.textContent = isOperatorStart
      ? 'Operate the screen directly.'
      : (isResearcherStart ? 'Research deeply.' : 'No task is too large.');
    if (introCopy) introCopy.textContent = isOperatorStart
      ? 'Tell Operator what to open, click, type, or inspect.'
      : (isResearcherStart
        ? 'Tell Researcher what to investigate, compare, or synthesize.'
        : "Tell Orion what we're taking on.");
    if (newChatPromptEl) {
      newChatPromptEl.placeholder = isDispatchStart
        ? 'Ask Orion anything...'
        : (isOperatorStart
          ? 'Ask Operator to open, click, type, or navigate...'
          : (isResearcherStart ? 'Ask Researcher to investigate...' : 'What should we build?'));
    }
  }

  function closeAppDrawer() {
    appDrawerOverlay.classList.remove('open');
  }

  function openAppDrawer() {
    updateDrawerState();
    appDrawerOverlay.classList.add('open');
  }

  function updateDrawerState() {
    const activeMode = currentScreen === 'screen-main' ? activeConversationMode : companionMode;
    document.querySelectorAll('[data-drawer-destination]').forEach(btn => {
      const destination = btn.getAttribute('data-drawer-destination');
      let active = false;
      if (destination === 'settings') active = currentScreen === 'screen-settings';
      else if (destination === 'orion') active = currentScreen === 'screen-main' && activeMode === 'orion';
      else if (isCompanionSpecialistMode(destination)) {
        active = currentScreen !== 'screen-settings' && currentScreen !== 'screen-home'
          ? activeMode === destination
          : currentScreen === 'screen-home' && companionMode === destination;
      }
      btn.classList.toggle('active', active);
    });
    if (drawerMeta) drawerMeta.textContent = 'Connected to ' + machineName + ' - ' + companionBuild;
  }

  function openModeHome(mode) {
    companionMode = normalizeCompanionMode(mode);
    localStorage.setItem('orionCompanionMode', companionMode);
    applyModeToggleUI();
    closeAppDrawer();
    if (companionMode === 'orion') {
      // Switching roles is a visible user action, so the chrome must change immediately. Do not
      // leave a Coder/Operator transcript in charge of the drawer and specialist tabs while the
      // asynchronous Dispatch conversation selection is still resolving.
      activeConversationMode = 'orion';
      updateSpecialistTabVisibility('orion');
      updateDrawerState();
      enterDispatch();
      return;
    }
    showScreen('screen-home');
    updateHomeScreen(lastLoadedState || { conversations: allConversations, projects: availableProjects, globalRunning: false });
  }

  function startDispatchDraft(options = {}) {
    companionMode = 'orion';
    activeConversationMode = 'orion';
    dispatchDraftActive = true;
    dispatchDraftProjectPath = String(options.projectPath || '').trim();
    dispatchDraftContextSummary = String(options.contextSummary || '').trim();
    currentConversationId = '';
    localStorage.setItem('orionCompanionMode', companionMode);
    applyModeToggleUI();
    closeAppDrawer();
    showScreen('screen-main');
    switchTab('panel-chat');
    lastDispatchLandingSignature = '';
    renderDispatchLanding(lastLoadedState || { conversations: allConversations, projects: availableProjects, activeWork: [] }, { resetScroll: true });
    updateDrawerState();
    // Do NOT auto-focus the prompt on mobile — it would immediately pop the keyboard.
    // The user taps the input field when they're ready to type.
  }

  async function cancelPendingTasksForNewFocus() {
    const response = await companionFetch('/api/new-focus', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Could not start a new focus');
    }
    return result;
  }

  async function enterDispatch(options = {}) {
    try {
      companionMode = 'orion';
      activeConversationMode = 'orion';
      localStorage.setItem('orionCompanionMode', companionMode);
      applyModeToggleUI();
      closeAppDrawer();
      updateSpecialistTabVisibility('orion');
      updateDrawerState();

      if (options.fresh === true) {
        // Cancel pending work owned by the current Dispatch conversation before detaching the
        // phone into a blank draft. If cancellation fails, preserve the old focus visibly.
        await cancelPendingTasksForNewFocus();
        startDispatchDraft(options);
        return;
      }

      if (dispatchDraftActive) {
        startDispatchDraft(options);
        return;
      }

      const target = allConversations.find(conversation =>
        conversation.id === lastDispatchConversationId && (conversation.mode || 'orion') === 'orion'
      );
      if (!target) {
        startDispatchDraft(options);
        return;
      }

      showScreen('screen-main');
      switchTab('panel-chat');
      if (currentConversationId !== target.id || activeConversationMode !== 'orion') {
        messagesEl.innerHTML = '<div class="empty">Loading conversation...</div>';
        await switchTask(target.id);
      }
      updateDrawerState();
    } catch (error) {
      statusEl.textContent = error.message || 'Could not open Dispatch';
      if (currentScreen !== 'screen-main') showScreen('screen-main');
      showChatError(error.message || 'Could not open Dispatch');
    }
  }

  function renderApprovalCards(conversations, options = {}) {
    const approvals = (conversations || []).filter(c => c.awaitingPlanApproval && (c.mode || 'orion') === 'coder');
    const scoped = options.projectPath
      ? approvals.filter(c => c.projectPath === options.projectPath)
      : approvals;
    if (!scoped.length) return '';
    return '<div class="home-section" data-approval-section="true">' +
      '<div class="home-section-title">Needs Approval</div>' +
      '<div class="home-approval-list">' + scoped.map(c => {
        const projectName = c.projectPath ? projectNameFromPath(c.projectPath, c.projectPath) : 'Standalone';
        return '<div class="home-approval-card">' +
          '<div>' +
            '<div class="home-approval-title">' + escapeHtml(c.title) + '</div>' +
            '<div class="home-approval-meta">' + escapeHtml(projectName) + ' - ' + escapeHtml(c.discussionSummary || conversationActivityLabel(c)) + '</div>' +
          '</div>' +
          '<div class="home-approval-actions">' +
            '<button class="btn-sm" type="button" data-open-conversation="true" data-conversation-id="' + escapeHtml(c.id) + '">View</button>' +
            '<button class="btn-sm danger" type="button" data-deny-plan="' + escapeHtml(c.id) + '">Deny</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div></div>';
  }

  function renderPhoneTaskList(tasks) {
    const items = Array.isArray(tasks) ? tasks : [];
    if (!taskListCard || !phoneTaskList || !taskListProgress) return;
    taskListCard.classList.toggle('visible', items.length > 0);
    if (!items.length) {
      phoneTaskList.innerHTML = '';
      taskListProgress.textContent = '0%';
      return;
    }
    const completed = items.filter(task => task.status === 'completed' || task.status === 'x').length;
    taskListProgress.textContent = Math.round((completed / items.length) * 100) + '%';
    phoneTaskList.innerHTML = items.map(task => {
      const status = task.status === 'completed' || task.status === 'x'
        ? 'completed'
        : (task.status === 'in-progress' || task.status === '/' ? 'in-progress' : 'pending');
      return '<div class="phone-task-item ' + status + '">' +
        '<span class="phone-task-dot"></span>' +
        '<span class="phone-task-title">' + escapeHtml(task.title || '') + '</span>' +
      '</div>';
    }).join('');
  }

  // ── Connection badge ─────────────────────────────
  function refreshConnBadge() {
    const dot = connBadgeEl.querySelector('.conn-dot');
    if (!deviceSession) {
      connBadgeEl.className = 'conn-badge offline';
      connTextEl.textContent = 'Pairing required';
      if (dot) dot.classList.remove('pulse');
      return;
    }
    if (sseConnected) {
      connBadgeEl.className = 'conn-badge';
      connTextEl.textContent = machineName + ' · Live';
      if (dot) dot.classList.remove('pulse');
    } else if (sseActive) {
      connBadgeEl.className = 'conn-badge polling';
      connTextEl.textContent = machineName + ' · Connecting';
      if (dot) dot.classList.add('pulse');
    } else {
      connBadgeEl.className = 'conn-badge polling';
      connTextEl.textContent = machineName + ' · Polling';
      if (dot) dot.classList.add('pulse');
    }
  }

  // ── Home screen ───────────────────────────────────
  function updateHomeScreen(state) {
    // Connection badge
    refreshConnBadge();
    const oldHomeScrollTop = homeBodyEl ? homeBodyEl.scrollTop : 0;

    // Projects
    const projects = availableProjects;
    const recentWs = getRecentWorkspaces();
    const allProj = [...projects];

    // Merge recent workspaces not already in projects
    recentWs.forEach(w => {
      if (!allProj.find(p => p.path === w.path)) {
        allProj.push({ path: w.path, name: w.name, conversationCount: 0 });
      }
    });

    // Polling and SSE often deliver an identical home model. Replacing the list DOM anyway
    // interrupts mobile momentum scrolling and can snap the Coder home back toward the top.
    // Only rebuild when something the screen actually displays has changed.
    const conversations = (state.conversations || []).filter(c => (c.mode || 'orion') === companionMode);
    const query = homeSearchEl.value.trim().toLowerCase();
    const homeSignature = JSON.stringify({
      mode: companionMode,
      query,
      runningId: state.runningConversationId || '',
      globalRunning: !!state.globalRunning,
      projects: allProj.map(p => [p.path, p.name, p.conversationCount || 0]),
      conversations: conversations.map(c => [
        c.id, c.title, c.updatedAt || 0, !!c.awaitingPlanApproval,
        c.messageCount || 0, c.taskCount || 0
      ])
    });
    if (homeSignature === lastHomeSignature) return;
    lastHomeSignature = homeSignature;

    // Projects only ever belong to Coder -- never shown while browsing Dispatch.
    if (companionMode === 'coder' && allProj.length > 0) {
      homeProjectsSection.style.display = '';
      homeProjectsEl.innerHTML = allProj.map(p => {
        const count = p.conversationCount || 0;
        return '<button type="button" class="home-proj-row" data-open-project="true" data-project-path="' + escapeHtml(p.path) + '" data-project-name="' + escapeHtml(p.name) + '">' +
          '<div class="home-proj-icon">&#x1F4C1;</div>' +
          '<div class="home-proj-info">' +
            '<div class="home-proj-name">' + escapeHtml(p.name) + '</div>' +
            '<div class="home-proj-path">' + escapeHtml(p.path) + '</div>' +
          '</div>' +
          '<span class="home-proj-count">' + (count > 0 ? count + ' chat' + (count !== 1 ? 's' : '') : '') + '</span>' +
        '</button>';
      }).join('');
    } else {
      homeProjectsSection.style.display = 'none';
    }

    if (homeApprovalsSection) {
      homeApprovalsSection.innerHTML = companionMode === 'coder'
        ? renderApprovalCards(state.conversations || [])
        : '';
    }

    // Recent chats -- Dispatch and every registered specialist only see their own conversations here.
    // Legacy conversations saved before the mode field existed default to Dispatch.
    const homeSpecialist = companionSpecialistDefinition(companionMode);
    homeRecentsTitleEl.textContent = homeSpecialist
      ? homeSpecialist.label + (homeSpecialist.canControlDesktop ? ' Sessions' : ' Chats')
      : 'Dispatch Discussions';
    homeClearProjectEl.classList.remove('visible');
    const filtered = query ? conversations.filter(c => c.title && c.title.toLowerCase().includes(query)) : conversations;

    if (filtered.length > 0) {
      const runningId = state.runningConversationId;
      const globalRunning = !!state.globalRunning;
      homeRecentsEl.innerHTML = filtered.map(c => {
        const isRunning = globalRunning && c.id === runningId;
        const isAwaiting = !!c.awaitingPlanApproval;
        const dotClass = isRunning ? 'running' : (isAwaiting ? 'attention' : '');
        const metaParts = [];
        if (isRunning) metaParts.push('Running');
        else if (isAwaiting) metaParts.push('Needs approval');
        // A real last-message preview is more useful than a bare count, and is already durable
        // across restarts (see dispatchDiscussionSummary in the on-disk index) - prefer it the
        // same way the Dispatch discussion browser already does, falling back to the count/task
        // label only when no discussion text is available yet.
        else metaParts.push(c.discussionSummary || conversationActivityLabel(c));
        return '<div class="home-recent-row-wrap">' +
          '<button type="button" class="home-recent-row" data-open-conversation="true" data-conversation-id="' + escapeHtml(c.id) + '">' +
          '<span class="home-recent-dot ' + dotClass + '"></span>' +
          '<div class="home-recent-info">' +
            '<div class="home-recent-title">' + escapeHtml(c.title) + '</div>' +
            '<div class="home-recent-meta">' + escapeHtml(metaParts.join(' · ')) + '</div>' +
          '</div>' +
          '<span class="home-recent-time">' + relativeTime(c.updatedAt) + '</span>' +
          '</button>' +
          '<button class="home-delete-chat" type="button" data-delete-conversation="true" data-conversation-id="' + escapeHtml(c.id) + '" title="Delete chat">&times;</button>' +
        '</div>';
      }).join('');
    } else if (query) {
      homeRecentsEl.innerHTML = '<div class="home-empty">No chats matching "' + escapeHtml(query) + '"</div>';
    } else {
      homeRecentsEl.innerHTML = '<div class="home-empty">No recent chats yet.</div>';
    }
    if (currentScreen === 'screen-home') restoreScrollTop(homeBodyEl, oldHomeScrollTop);
  }

  function dispatchConversationsForProject(projectPath) {
    return allConversations.filter(function(conversation) {
      return (conversation.mode || 'orion') === 'orion'
        && String(conversation.dispatchProjectPath || '') === String(projectPath || '');
    }).sort(function(a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  function buildDispatchProjectGroups() {
    const byPath = {};
    availableProjects.forEach(function(project) {
      if (!project || !project.path) return;
      byPath[project.path] = {
        path: project.path,
        name: project.name || projectNameFromPath(project.path, project.path),
        conversations: dispatchConversationsForProject(project.path),
        updatedAt: project.updatedAt || 0
      };
    });
    allConversations.forEach(function(conversation) {
      if ((conversation.mode || 'orion') !== 'orion' || !conversation.dispatchProjectPath) return;
      const projectPath = conversation.dispatchProjectPath;
      if (!byPath[projectPath]) {
        byPath[projectPath] = {
          path: projectPath,
          name: projectNameFromPath(projectPath, projectPath),
          conversations: dispatchConversationsForProject(projectPath),
          updatedAt: 0
        };
      }
    });
    return Object.keys(byPath).map(function(projectPath) {
      const group = byPath[projectPath];
      const latest = group.conversations[0];
      group.updatedAt = Math.max(group.updatedAt || 0, latest ? latest.updatedAt || 0 : 0);
      group.latest = latest || null;
      return group;
    }).sort(function(a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  function renderDispatchLanding(state, options = {}) {
    if (!messagesEl) return;
    const recentSessions = allConversations
      .filter(function(conversation) { return (conversation.mode || 'orion') === 'orion'; })
      .slice()
      .sort(function(a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })
      .slice(0, 3);
    const signature = JSON.stringify(recentSessions.map(function(conversation) {
      return [conversation.id, conversation.title, conversation.updatedAt || 0];
    }));
    if (signature === lastDispatchLandingSignature) {
      if (options.resetScroll) messagesEl.scrollTop = 0;
      return;
    }
    const oldScrollTop = messagesEl.scrollTop;
    lastDispatchLandingSignature = signature;
    let html = '<div class="dispatch-landing">' +
      '<div class="dispatch-landing-intro">' +
        '<div class="dispatch-landing-title">' + escapeHtml(dispatchGreeting()) + '</div>' +
        '<div class="dispatch-landing-copy">No task is too large. What are we taking on?</div>' +
      '</div>';

    if (recentSessions.length) {
      html += '<section class="dispatch-landing-section"><div class="dispatch-landing-section-head"><span>Continue</span>' +
        '<button class="dispatch-landing-browse" type="button" data-open-dispatch-browser="true">View all</button></div>' +
        recentSessions.map(function(conversation) {
          return '<button class="dispatch-project-row" type="button" data-open-recent-session="' + escapeHtml(conversation.id || '') + '">' +
            '<span class="dispatch-row-copy"><span class="dispatch-row-title">' + escapeHtml(conversation.title || 'Discussion') + '</span></span>' +
            '<span class="dispatch-row-time">' + (conversation.updatedAt ? relativeTime(conversation.updatedAt) : '') + '</span>' +
          '</button>';
        }).join('') + '</section>';
    }

    html += '</div>';
    messagesEl.innerHTML = html;
    if (options.resetScroll) messagesEl.scrollTop = 0;
    else restoreScrollTop(messagesEl, oldScrollTop);
    chatProjNameEl.textContent = 'Orion';
    statusPillEl.textContent = 'Ready';
    statusPillEl.classList.remove('running');
    dispatchBrowseButton.classList.add('visible');
  }

  function renderDispatchBrowser() {
    const query = String(dispatchBrowserSearch.value || '').trim().toLowerCase();
    const discussions = allConversations.filter(function(conversation) {
      if ((conversation.mode || 'orion') !== 'orion') return false;
      const searchable = ((conversation.title || '') + ' ' + (conversation.discussionSummary || '')).toLowerCase();
      return !query || searchable.indexOf(query) !== -1;
    }).sort(function(a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });

    let html = '<div class="dispatch-browser-section-label">Discussions</div>';
    html += discussions.length ? discussions.map(function(conversation) {
      return '<button class="dispatch-browser-thread" type="button" data-open-dispatch-conversation="' + escapeHtml(conversation.id) + '">' +
        '<span class="dispatch-row-copy"><span class="dispatch-row-title">' + escapeHtml(conversation.title || 'Discussion') + '</span>' +
        '<span class="dispatch-row-meta">' + escapeHtml(conversation.discussionSummary || conversationActivityLabel(conversation)) + '</span></span>' +
        '<span class="dispatch-row-time">' + relativeTime(conversation.updatedAt) + '</span></button>';
    }).join('') : '<div class="home-empty">No matching discussions.</div>';
    dispatchBrowserContent.innerHTML = html;
  }

  function openDispatchBrowser() {
    renderDispatchBrowser();
    dispatchBrowserOverlay.classList.add('open');
    // Do NOT auto-focus the search field on mobile — keyboard would block the menu items.
  }

  function closeDispatchBrowser() {
    dispatchBrowserOverlay.classList.remove('open');
  }

  function openDispatchProject(projectPath) {
    const group = buildDispatchProjectGroups().find(function(candidate) { return candidate.path === projectPath; });
    if (!group) return;
    selectedDispatchProjectPath = group.path;
    const latest = group.latest;
    const summary = latest && latest.discussionSummary
      ? 'You last discussed ' + latest.discussionSummary.replace(/[.!?]+$/, '') + '.'
      : 'Start a new Dispatch discussion with this project selected.';
    dispatchProjectTitle.textContent = group.name;
    dispatchProjectSummary.textContent = summary;
    dispatchProjectContinue.disabled = !latest;
    dispatchProjectContinue.setAttribute('data-conversation-id', latest ? latest.id : '');
    dispatchProjectFresh.setAttribute('data-context-summary', summary);
    dispatchProjectThreads.innerHTML = group.conversations.slice(0, 6).map(function(conversation) {
      return '<button class="dispatch-browser-thread" type="button" data-open-dispatch-conversation="' + escapeHtml(conversation.id) + '">' +
        '<span class="dispatch-row-copy"><span class="dispatch-row-title">' + escapeHtml(conversation.title || 'Discussion') + '</span>' +
        '<span class="dispatch-row-meta">' + escapeHtml(conversation.discussionSummary || '') + '</span></span>' +
        '<span class="dispatch-row-time">' + relativeTime(conversation.updatedAt) + '</span></button>';
    }).join('') || '<div class="home-empty">No previous discussions.</div>';
    closeDispatchBrowser();
    dispatchProjectOverlay.classList.add('open');
  }

  function closeDispatchProject() {
    dispatchProjectOverlay.classList.remove('open');
  }

  function conversationActivityLabel(conversation) {
    const messageCount = Number(conversation && conversation.messageCount || 0);
    const taskCount = Number(conversation && conversation.taskCount || 0);
    const parts = [];
    if (messageCount > 0) parts.push(messageCount + ' message' + (messageCount === 1 ? '' : 's'));
    if (taskCount > 0) parts.push(taskCount + ' task' + (taskCount === 1 ? '' : 's'));
    if (parts.length) return parts.join(' + ');
    // Most conversations arrive as desktop stubs with no live message array (only the one open on
    // desktop is fully hydrated), so messageCount/taskCount read as 0 even when real history
    // exists. hasMessages is a durable flag desktop carries across restarts specifically for this
    // case. Falling straight to "No messages yet" here was a false claim, not an actual empty
    // conversation — this only says that once hasMessages is also false.
    return conversation && conversation.hasMessages ? 'Previous messages' : 'No messages yet';
  }

  function selectHomeProject(path, name) {
    newChatSelectedProject = path || '';
    projSelectorNameEl.textContent = name || projectNameFromPath(path);
    updateHomeScreen({ conversations: allConversations, projects: availableProjects, globalRunning: false });
  }
  window.selectHomeProject = selectHomeProject;

  function renderProjectScreen() {
    const project = availableProjects.find(p => p.path === projectDetailPath) || { path: projectDetailPath, name: projectDetailPath ? projectNameFromPath(projectDetailPath, projectDetailPath) : 'Project' };
    const projectName = project.name || project.path;
    const projectChats = allConversations
      .filter(c => c.projectPath === projectDetailPath)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const oldProjectScrollTop = projectScreenBodyEl ? projectScreenBodyEl.scrollTop : 0;
    const projectSignature = JSON.stringify({
      path: project.path || '',
      name: projectName,
      conversations: projectChats.map(c => [
        c.id, c.title, c.updatedAt || 0, !!c.awaitingPlanApproval,
        c.messageCount || 0, c.taskCount || 0, c.workspace || ''
      ])
    });
    if (projectSignature === lastProjectScreenSignature) return;
    lastProjectScreenSignature = projectSignature;
    projectScreenHeadingEl.textContent = projectName;
    projectScreenTitleEl.textContent = projectName;
    projectScreenPathEl.textContent = project.path || '';
    projectScreenMetaEl.textContent = projectChats.length + (projectChats.length === 1 ? ' chat' : ' chats') +
      (projectChats.length ? ' • last used ' + relativeTime(projectChats[0].updatedAt) : '');
    if (projectApprovalsSection) {
      projectApprovalsSection.innerHTML = renderApprovalCards(allConversations, { projectPath: projectDetailPath });
    }
    if (!projectChats.length) {
      projectThreadListEl.innerHTML = '<div class="home-empty">No chats in this project yet. Tap + New to start one.</div>';
      if (currentScreen === 'screen-project') restoreScrollTop(projectScreenBodyEl, oldProjectScrollTop);
      return;
    }
    projectThreadListEl.innerHTML = projectChats.map(c => {
      const metaParts = [];
      if (c.awaitingPlanApproval) metaParts.push('Needs approval');
      metaParts.push(c.discussionSummary || conversationActivityLabel(c));
      if (c.workspace && c.workspace !== c.projectPath) metaParts.push('Workspace changed');
      return '<div class="home-recent-row-wrap">' +
        '<button type="button" class="home-recent-row" data-open-conversation="true" data-conversation-id="' + escapeHtml(c.id) + '">' +
        '<span class="home-recent-dot ' + (c.awaitingPlanApproval ? 'attention' : '') + '"></span>' +
        '<div class="home-recent-info">' +
          '<div class="home-recent-title">' + escapeHtml(c.title) + '</div>' +
          '<div class="home-recent-meta">' + escapeHtml(metaParts.join(' • ')) + '</div>' +
        '</div>' +
        '<span class="home-recent-time">' + relativeTime(c.updatedAt) + '</span>' +
        '</button>' +
        '<button class="home-delete-chat" type="button" data-delete-conversation="true" data-conversation-id="' + escapeHtml(c.id) + '" title="Delete chat">&times;</button>' +
      '</div>';
    }).join('');
    if (currentScreen === 'screen-project') restoreScrollTop(projectScreenBodyEl, oldProjectScrollTop);
  }

  function openProjectScreen(path, name) {
    projectDetailPath = path || '';
    newChatSelectedProject = projectDetailPath;
    projSelectorNameEl.textContent = name || projectNameFromPath(path);
    renderProjectScreen();
    showScreen('screen-project');
    if (projectScreenBodyEl) projectScreenBodyEl.scrollTop = 0;
  }
  window.openProjectScreen = openProjectScreen;

  function applyModeToggleUI() {
    modeToggleButtons.forEach(button => {
      button.classList.toggle('active', normalizeCompanionMode(button.dataset.mode) === companionMode);
    });
    updateDrawerState();
  }
  applyModeToggleUI();

  document.querySelectorAll('[data-open-drawer]').forEach(btn => btn.addEventListener('click', openAppDrawer));
  appDrawerClose.addEventListener('click', closeAppDrawer);
  appDrawerOverlay.addEventListener('click', event => {
    if (event.target === appDrawerOverlay) closeAppDrawer();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && appDrawerOverlay.classList.contains('open')) closeAppDrawer();
  });
  document.querySelectorAll('[data-drawer-destination]').forEach(btn => {
    btn.addEventListener('click', () => {
      const destination = btn.getAttribute('data-drawer-destination');
      if (destination === 'settings') {
        closeAppDrawer();
        showScreen('screen-settings');
        updateDrawerState();
      } else {
        openModeHome(destination);
      }
    });
  });
  dispatchRunningBanner.addEventListener('click', () => {
    const conversationId = dispatchRunningBanner.getAttribute('data-conversation-id') || '';
    if (conversationId) openConversation(conversationId);
  });
  dispatchBrowseButton.addEventListener('click', openDispatchBrowser);
  dispatchBrowserClose.addEventListener('click', closeDispatchBrowser);
  document.getElementById('dispatch-browser-new-chat').addEventListener('click', () => {
    closeDispatchBrowser();
    startDispatchDraft();
  });
  dispatchProjectClose.addEventListener('click', closeDispatchProject);
  dispatchBrowserSearch.addEventListener('input', renderDispatchBrowser);
  dispatchBrowserOverlay.addEventListener('click', event => {
    if (event.target === dispatchBrowserOverlay) closeDispatchBrowser();
  });
  dispatchProjectOverlay.addEventListener('click', event => {
    if (event.target === dispatchProjectOverlay) closeDispatchProject();
  });
  messagesEl.addEventListener('click', event => {
    const browse = event.target.closest('[data-open-dispatch-browser]');
    if (browse) { openDispatchBrowser(); return; }
    const project = event.target.closest('[data-open-dispatch-project]');
    if (project) { openDispatchProject(project.getAttribute('data-open-dispatch-project') || ''); return; }
    const recentSession = event.target.closest('[data-open-recent-session]');
    if (recentSession) {
      const conversationId = recentSession.getAttribute('data-open-recent-session') || '';
      if (conversationId) openConversation(conversationId);
    }
  });
  dispatchBrowserContent.addEventListener('click', event => {
    const project = event.target.closest('[data-open-dispatch-project]');
    if (project) { openDispatchProject(project.getAttribute('data-open-dispatch-project') || ''); return; }
    const conversation = event.target.closest('[data-open-dispatch-conversation]');
    if (conversation) {
      closeDispatchBrowser();
      openConversation(conversation.getAttribute('data-open-dispatch-conversation') || '');
    }
  });
  dispatchProjectThreads.addEventListener('click', event => {
    const conversation = event.target.closest('[data-open-dispatch-conversation]');
    if (!conversation) return;
    closeDispatchProject();
    openConversation(conversation.getAttribute('data-open-dispatch-conversation') || '');
  });
  dispatchProjectContinue.addEventListener('click', () => {
    const conversationId = dispatchProjectContinue.getAttribute('data-conversation-id') || '';
    if (!conversationId) return;
    closeDispatchProject();
    openConversation(conversationId);
  });
  dispatchProjectFresh.addEventListener('click', () => {
    const contextSummary = dispatchProjectFresh.getAttribute('data-context-summary') || '';
    closeDispatchProject();
    startDispatchDraft({ projectPath: selectedDispatchProjectPath, contextSummary });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (dispatchProjectOverlay.classList.contains('open')) closeDispatchProject();
    else if (dispatchBrowserOverlay.classList.contains('open')) closeDispatchBrowser();
  });
  settingsBackEl.addEventListener('click', () => {
    if (companionMode === 'orion') enterDispatch();
    else {
      showScreen('screen-home');
      updateDrawerState();
    }
  });

  function setCompanionMode(mode) {
    const next = normalizeCompanionMode(mode);
    if (next === 'orion') {
      enterDispatch();
      return;
    }
    if (next === companionMode) return;
    companionMode = next;
    localStorage.setItem('orionCompanionMode', companionMode);
    applyModeToggleUI();
    updateNewChatModeUI();
    updateHomeScreen(lastLoadedState || { conversations: allConversations, projects: availableProjects, globalRunning: false });
  }
  modeToggleButtons.forEach(button => {
    button.addEventListener('click', () => setCompanionMode(button.dataset.mode));
  });

  homeClearProjectEl.addEventListener('click', () => {
    projectDetailPath = '';
    newChatSelectedProject = '';
    const selectedProject = availableProjects.find(p => p.path === newChatSelectedProject);
    projSelectorNameEl.textContent = selectedProject
      ? selectedProject.name
      : (newChatSelectedProject ? projectNameFromPath(newChatSelectedProject, newChatSelectedProject) : 'Standalone');
    updateHomeScreen({ conversations: allConversations, projects: availableProjects, globalRunning: false });
  });

  projectBackEl.addEventListener('click', () => {
    showScreen('screen-home');
    updateHomeScreen({ conversations: allConversations, projects: availableProjects, globalRunning: false });
  });

  projectNewChatEl.addEventListener('click', () => {
    const selectedProject = availableProjects.find(p => p.path === projectDetailPath);
    openProjectInNewChat(projectDetailPath, selectedProject ? selectedProject.name : '');
  });

  async function deleteHomeConversation(id) {
    if (!id) return;
    const conv = allConversations.find(c => c.id === id);
    const title = conv && conv.title ? conv.title : 'this chat';
    const confirmed = await showPhoneConfirmDialog({
      title: 'Delete chat?',
      message: 'Delete "' + title + '" from Orion? This cannot be undone.',
      confirmLabel: 'Delete'
    });
    if (!confirmed) return;
    const res = await companionFetch('/api/conversations/delete', {
      method: 'POST',
      body: JSON.stringify({ conversationId: id, confirmed: true })
    });
    const data = await res.json();
    if (!data.success) {
      statusEl.textContent = data.error || 'Delete failed';
      return;
    }
    await loadState();
    if (currentScreen === 'screen-project') renderProjectScreen();
  }
  window.deleteHomeConversation = deleteHomeConversation;

  function openConversation(id) {
    if (!id) return;
    const target = allConversations.find(conversation => conversation.id === id);
    if (target) {
      const targetMode = normalizeCompanionMode(target.mode || 'orion');
      companionMode = targetMode;
      // The selected conversation is durable evidence of the destination role. Bind the visible
      // conversation mode immediately instead of leaving the previous role in charge until a
      // later state snapshot arrives. Otherwise a fast Dispatch -> Coder/Operator switch can show
      // the new transcript while retaining Dispatch-only chrome (notably a hidden specialist tab
      // bar) until another poll happens to repair it.
      activeConversationMode = targetMode;
      localStorage.setItem('orionCompanionMode', companionMode);
      applyModeToggleUI();
      if (companionMode === 'orion') {
        dispatchDraftActive = false;
        lastDispatchConversationId = id;
      }
    }
    lastSignature = '';
    messagesEl.innerHTML = '<div class="empty">Loading conversation...</div>';
    showScreen('screen-main');
    updateSpecialistTabVisibility(activeConversationMode);
    updateDrawerState();
    switchTab('panel-chat');
    switchTask(id);
  }
  window.openConversation = openConversation;

  homeProjectsEl.addEventListener('click', event => {
    const row = event.target.closest('[data-open-project]');
    if (!row || !homeProjectsEl.contains(row)) return;
    openProjectScreen(row.dataset.projectPath || '', row.dataset.projectName || '');
  });

  function handleConversationListClick(event) {
    const deleteBtn = event.target.closest('[data-delete-conversation]');
    if (deleteBtn) {
      event.stopPropagation();
      deleteHomeConversation(deleteBtn.dataset.conversationId || '');
      return;
    }
    const row = event.target.closest('[data-open-conversation]');
    if (!row) return;
    openConversation(row.dataset.conversationId || '');
  }

  homeRecentsEl.addEventListener('click', handleConversationListClick);
  projectThreadListEl.addEventListener('click', handleConversationListClick);
  homeApprovalsSection.addEventListener('click', handleConversationListClick);
  projectApprovalsSection.addEventListener('click', handleConversationListClick);

  function openProjectInNewChat(path, name) {
    newChatSelectedProject = path;
    projSelectorNameEl.textContent = name || projectNameFromPath(path);
    updateNewChatModeUI();
    showScreen('screen-new-chat');
  }
  window.openProjectInNewChat = openProjectInNewChat;

  // ── Bottom tab navigation ─────────────────────────
  const navBtns  = document.querySelectorAll('.nav-btn');
  const panelEls = document.querySelectorAll('.tab-panel');
  const bottomNav = document.querySelector('.bottom-nav');
  function switchTab(panelId) {
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.panel === panelId));
    panelEls.forEach(p => p.classList.toggle('active', p.id === panelId));
  }
  function updateSpecialistTabVisibility(mode) {
    const isSpecialist = isCompanionSpecialistMode(mode);
    if (bottomNav) bottomNav.classList.toggle('hidden', !isSpecialist);
    if (!isSpecialist && !document.getElementById('panel-chat').classList.contains('active')) {
      switchTab('panel-chat');
    }
  }

  function showReconnectBanner(text = 'Reconnecting to Orion…') {
    if (!reconnectBannerEl) return;
    reconnectBannerEl.textContent = text;
    reconnectBannerEl.classList.add('active');
  }

  function hideReconnectBanner() {
    if (reconnectBannerEl) reconnectBannerEl.classList.remove('active');
  }
  navBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.panel)));

  // Home back from main
  document.getElementById('main-back').addEventListener('click', () => {
    showScreen('screen-home');
  });

  // Home → New Chat screen
  document.getElementById('home-new-chat').addEventListener('click', () => {
    if (companionMode === 'orion') {
      enterDispatch({ fresh: true });
      return;
    }
    newChatSelectedProject = '';
    projSelectorNameEl.textContent = 'Standalone';
    updateNewChatModeUI();
    showScreen('screen-new-chat');
  });

  // New Chat screen: back
  document.getElementById('new-chat-back').addEventListener('click', () => showScreen('screen-home'));

  // New Chat: project selector button → open picker overlay
  projSelectorBtn.addEventListener('click', () => {
    // Build project list
    const standaloneHtml = '<div class="proj-picker-item' + (newChatSelectedProject === '' ? ' selected' : '') + '" data-path="" data-name="Standalone">' +
      '<span class="proj-picker-item-icon">&#x2726;</span>' +
      '<div class="proj-picker-item-info"><div class="proj-picker-item-name">Standalone</div><div class="proj-picker-item-path">No project workspace</div></div>' +
    '</div>';
    const projHtml = availableProjects.map(p =>
      '<div class="proj-picker-item' + (newChatSelectedProject === p.path ? ' selected' : '') + '" data-path="' + escapeHtml(p.path) + '" data-name="' + escapeHtml(p.name) + '">' +
        '<span class="proj-picker-item-icon">&#x1F4C1;</span>' +
        '<div class="proj-picker-item-info"><div class="proj-picker-item-name">' + escapeHtml(p.name) + '</div><div class="proj-picker-item-path">' + escapeHtml(p.path) + '</div></div>' +
      '</div>'
    ).join('');
    projPickerList.innerHTML = standaloneHtml + projHtml;
    projPickerList.querySelectorAll('.proj-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        newChatSelectedProject = item.dataset.path;
        projSelectorNameEl.textContent = item.dataset.name || 'Standalone';
        projPickerOverlay.classList.remove('open');
      });
    });
    projPickerOverlay.classList.add('open');
  });
  projPickerOverlay.addEventListener('click', (e) => { if (e.target === projPickerOverlay) projPickerOverlay.classList.remove('open'); });

  // ── Start new phone chat ──────────────────────────
  async function startNewPhoneChat(projectPath, promptText) {
    // A project selected through this screen belongs to Coder. A standalone chat inherits the
    // selected Dispatch/Coder/Operator mode; Operator intentionally has no project picker here.
    const mode = projectPath ? 'coder' : companionMode;
    if (mode === 'orion' && !promptText) {
      startDispatchDraft();
      return;
    }
    const res = await companionFetch('/api/conversations/new', {
      method: 'POST',
      body: JSON.stringify({
        prompt: promptText || '',
        projectPath: projectPath || '',
        mode,
        requestId: 'phone_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9)
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'New chat failed');
    acceptedConversationSelectionRevision = Math.max(acceptedConversationSelectionRevision, Number(data.selectionRevision) || 0);
    currentConversationId = data.conversationId || currentConversationId;
    pendingConversationSelectionId = currentConversationId;
    if (mode === 'orion') {
      dispatchDraftActive = false;
      lastDispatchConversationId = currentConversationId;
    }
    // Navigate to chat screen before sending the prompt — if the prompt send fails,
    // the conversation is still reachable and the user isn't left on an orphaned new-chat form.
    await loadState({ force: true });
    showScreen('screen-main');
    // /api/conversations/new already forwards a non-empty prompt to the new conversation.
    // Sending it again here made every new Coder task execute the same request twice.
  }

  // New Chat: send
  document.getElementById('new-chat-send').addEventListener('click', async () => {
    const sendBtn = document.getElementById('new-chat-send');
    const promptTa = document.getElementById('new-chat-prompt');
    const text = promptTa.value.trim();
    sendBtn.disabled = true;
    sendBtn.classList.add('sending');
    try {
      await startNewPhoneChat(newChatSelectedProject, text);
      promptTa.value = '';
    } catch (err) {
      showChatError(err.message);
    } finally {
      sendBtn.disabled = false;
      sendBtn.classList.remove('sending');
    }
  });
  document.getElementById('new-chat-prompt').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 110) + 'px';
  });

  // Home search
  homeSearchEl.addEventListener('input', () => {
    if (allConversations.length > 0) {
      updateHomeScreen({ conversations: allConversations, globalRunning: false });
    }
  });

  // ── Markdown renderer ─────────────────────────────
  function renderMarkdown(text) {
    const raw = String(text || '').replace(/\\r\\n/g, '\\n').trim();
    if (!raw) return '';
    try {
      if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
        return sanitizeMarkdownHtml(marked.parse(raw, { gfm: true, breaks: false }));
      }
    } catch (e) {
      return renderMarkdownFallback(raw);
    }
    return renderMarkdownFallback(raw);
  }

  function renderMarkdownFallback(text) {
    const raw = String(text || '').replace(/\\r\\n/g, '\\n').trim();
    if (!raw) return '';
    const fence = String.fromCharCode(96, 96, 96);
    const lines = raw.split('\\n');
    const html = [];
    let paragraph = [];
    let list = null;
    let quote = [];
    let inCodeFence = false;
    let codeLanguage = '';
    let codeLines = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push('<p>' + renderInlineMarkdown(paragraph.join(' ')) + '</p>');
      paragraph = [];
    }
    function flushList() {
      if (!list) return;
      const tag = list.type === 'ol' ? 'ol' : 'ul';
      html.push('<' + tag + '>' + list.items.map(item => '<li>' + renderInlineMarkdown(item) + '</li>').join('') + '</' + tag + '>');
      list = null;
    }
    function flushQuote() {
      if (!quote.length) return;
      html.push('<blockquote>' + quote.map(line => renderInlineMarkdown(line)).join('<br>') + '</blockquote>');
      quote = [];
    }
    function flushFlow() {
      flushParagraph();
      flushList();
      flushQuote();
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();
      if (trimmed.indexOf(fence) === 0) {
        if (inCodeFence) {
          html.push('<pre><code' + (codeLanguage ? ' class="language-' + escapeHtml(codeLanguage) + '"' : '') + '>' + escapeHtml(codeLines.join('\\n')) + '</code></pre>');
          inCodeFence = false;
          codeLanguage = '';
          codeLines = [];
        } else {
          flushFlow();
          inCodeFence = true;
          codeLanguage = trimmed.slice(fence.length).trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
          codeLines = [];
        }
        continue;
      }
      if (inCodeFence) {
        codeLines.push(line);
        continue;
      }
      if (!trimmed) {
        flushFlow();
        continue;
      }
      if (isMarkdownTableAt(lines, index)) {
        flushFlow();
        const table = consumeMarkdownTable(lines, index);
        html.push(table.html);
        index = table.nextIndex - 1;
        continue;
      }
      if (/^[-*_]{3,}$/.test(trimmed)) {
        flushFlow();
        html.push('<hr>');
        continue;
      }
      const heading = trimmed.match(/^(#{1,4})\\s+(.+)$/);
      if (heading) {
        flushFlow();
        const level = Math.min(heading[1].length, 4);
        html.push('<h' + level + '>' + renderInlineMarkdown(heading[2]) + '</h' + level + '>');
        continue;
      }
      const quoteMatch = trimmed.match(/^>\\s?(.*)$/);
      if (quoteMatch) {
        flushParagraph();
        flushList();
        quote.push(quoteMatch[1]);
        continue;
      }
      const unordered = trimmed.match(/^[-*]\\s+(.+)$/);
      const ordered = trimmed.match(/^\\d+[.)]\\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        flushQuote();
        const type = ordered ? 'ol' : 'ul';
        if (list && list.type !== type) flushList();
        if (!list) list = { type, items: [] };
        list.items.push((ordered || unordered)[1]);
        continue;
      }
      flushList();
      flushQuote();
      paragraph.push(trimmed);
    }
    if (inCodeFence) {
      html.push('<pre><code' + (codeLanguage ? ' class="language-' + escapeHtml(codeLanguage) + '"' : '') + '>' + escapeHtml(codeLines.join('\\n')) + '</code></pre>');
    }
    flushFlow();
    return html.join('');
  }

  function sanitizeMarkdownHref(href) {
    const value = String(href || '').trim();
    return new RegExp('^(https?:|mailto:|orion-file:|orion-artifact://)', 'i').test(value) ? value : '';
  }

  function sanitizeMarkdownHtml(html) {
    if (typeof document === 'undefined') return String(html || '');
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    template.content.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
      Array.from(node.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          node.removeAttribute(attr.name);
          return;
        }
        if (name === 'href') {
          const safeHref = sanitizeMarkdownHref(attr.value);
          if (!safeHref) {
            node.removeAttribute(attr.name);
            return;
          }
          node.setAttribute('href', safeHref);
          if (/^https?:/i.test(safeHref)) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
          }
          return;
        }
        if (name === 'src' && !/^https?:/i.test(String(attr.value || '').trim())) {
          node.removeAttribute(attr.name);
        }
      });
    });
    return template.innerHTML;
  }

  function renderInlineMarkdown(text) {
    const tick = String.fromCharCode(96);
    const codePattern = new RegExp(tick + '([^' + tick + ']+)' + tick, 'g');
    const placeholders = [];
    // Extract code spans and links from RAW text first — before any HTML-escaping.
    // This prevents double-escaping: calling renderInlineMarkdown recursively on a label
    // that was already escaped by escapeHtml would produce &amp;amp; etc.
    let processed = String(text || '').replace(codePattern, function(match, code) {
      const token = '\\u0000PH' + placeholders.length + '\\u0000';
      placeholders.push('<code>' + escapeHtml(code) + '</code>');
      return token;
    });
    processed = processed.replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, function(match, label, href) {
      const safeHref = sanitizeMarkdownHref(href);
      const safeLabel = renderInlineMarkdown(label); // label is raw — no double-escape
      const token = '\\u0000PH' + placeholders.length + '\\u0000';
      placeholders.push(safeHref
        ? '<a href="' + escapeHtml(safeHref) + '" target="_blank" rel="noopener noreferrer">' + safeLabel + '</a>'
        : safeLabel);
      return token;
    });
    // HTML-escape remaining plain text, then apply bold/italic (* and _ are not HTML-escaped so patterns still match)
    let html = escapeHtml(processed)
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|\\s)\\*([^*\\n]+)\\*/g, '$1<em>$2</em>')
      .replace(/(^|\\s)_([^_\\n]+)_/g, '$1<em>$2</em>');
    placeholders.forEach((value, index) => {
      html = html.replace('\\u0000PH' + index + '\\u0000', value);
    });
    return html;
  }

  function splitMarkdownTableRow(line) {
    return String(line || '').trim().replace(/^\\|/, '').replace(/\\|$/, '').split('|').map(cell => cell.trim());
  }

  function isMarkdownTableDivider(line) {
    const cells = splitMarkdownTableRow(line);
    return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
  }

  function isMarkdownTableAt(lines, index) {
    if (!lines[index + 1]) return false;
    const headerCells = splitMarkdownTableRow(lines[index]);
    return headerCells.length > 1 && isMarkdownTableDivider(lines[index + 1]);
  }

  function consumeMarkdownTable(lines, startIndex) {
    const headers = splitMarkdownTableRow(lines[startIndex]);
    const bodyRows = [];
    let index = startIndex + 2;
    while (index < lines.length) {
      const row = String(lines[index] || '').trim();
      if (!row || row.indexOf('|') === -1) break;
      bodyRows.push(splitMarkdownTableRow(row));
      index += 1;
    }
    const headerHtml = '<thead><tr>' + headers.map(cell => '<th>' + renderInlineMarkdown(cell) + '</th>').join('') + '</tr></thead>';
    const bodyHtml = bodyRows.length
      ? '<tbody>' + bodyRows.map(row => '<tr>' + row.map(cell => '<td>' + renderInlineMarkdown(cell) + '</td>').join('') + '</tr>').join('') + '</tbody>'
      : '';
    return { html: '<table>' + headerHtml + bodyHtml + '</table>', nextIndex: index };
  }

  function splitAssistantOutput(text) {
    const raw = String(text || '');
    const match = raw.match(/(?:^|\\n)## Work Walkthrough\\s*/);
    if (!match) return { answer: raw, walkthrough: '' };
    const start = match.index + (raw[match.index] === '\\n' ? 1 : 0);
    return {
      answer: raw.slice(0, start).trim(),
      walkthrough: raw.slice(start).trim()
    };
  }

  function parseWorkWalkthroughRows(walkthroughText) {
    const body = String(walkthroughText || '').replace(/^## Work Walkthrough\\s*/i, '').trim();
    if (!body) return [];
    return body.split(/\\n+/).map(line => line.trim()).filter(Boolean).map(line => {
      const cleaned = line
        .replace(/^[-*]\\s*/, '')
        .replace(/\\*\\*/g, '')
        .trim();
      const match = cleaned.match(/^([^:]+):\\s*(.*)$/);
      const rawStatus = match ? match[1].trim() : 'Done';
      const detail = match ? match[2].trim() : cleaned;
      const status = /^fail/i.test(rawStatus)
        ? 'failed'
        : (/^done|^complete|^passed/i.test(rawStatus) ? 'success' : rawStatus.toLowerCase().replace(/\\s+/g, '-'));
      return {
        status,
        label: rawStatus,
        detail
      };
    });
  }

  function renderWorkWalkthroughBlock(walkthroughText) {
    const rows = parseWorkWalkthroughRows(walkthroughText);
    if (!rows.length) return '';
    const renderedRows = rows.slice(-20).map(row =>
      '<div class="tool-run-badge walkthrough-row">' +
        '<div class="tool-call-info">' +
          '<span class="tool-name">' + escapeHtml(row.detail || 'Work item') + '</span>' +
          '<span class="tool-status ' + escapeHtml(row.status) + '">' + escapeHtml(row.label) + '</span>' +
        '</div>' +
      '</div>'
    ).join('');
    return '<div class="agent-logs-container walkthrough-panel">' +
      '<div class="agent-logs-header"><span>Work Walkthrough (' + rows.length + ' items)</span><span>hide</span></div>' +
      '<div class="agent-logs-body">' + renderedRows + '</div>' +
    '</div>';
  }

  function isAssistantThinkingPlaceholder(text) {
    return String(text || '').trim() === 'Thinking...';
  }

  function shouldHideAssistantThinkingPlaceholder(text, hasActivity, isRunning) {
    return isAssistantThinkingPlaceholder(text) && !hasActivity && !!isRunning;
  }

  function recoverIdleAssistantPlaceholder(text, hasActivity, isRunning) {
    if (!isAssistantThinkingPlaceholder(text) || hasActivity || isRunning) return '';
    return 'Session ended before a response was saved.';
  }

  function renderInlineTypingIndicator() {
    return '<div class="message assistant typing-assistant" aria-label="Orion is thinking">' +
      '<span class="role">assistant</span>' +
      '<div class="typing-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>' +
    '</div>';
  }

  // ── Form mode ─────────────────────────────────────
  function setFormMode(mode, targetConversationId = '') {
    formMode = mode;
    formTargetConversationId = mode === 'revise' ? String(targetConversationId || '') : '';
    if (mode === 'steer') {
      formModeBar.className = 'form-mode-bar visible';
      formModeLabel.textContent = 'Steering active work';
      promptEl.placeholder = 'How should Orion adjust its approach?';
      showScreen('screen-main'); switchTab('panel-chat'); promptEl.focus();
    } else if (mode === 'revise') {
      formModeBar.className = 'form-mode-bar revise-mode visible';
      formModeLabel.textContent = 'Revising plan';
      promptEl.placeholder = 'What should change in the plan?';
      showScreen('screen-main'); switchTab('panel-chat'); promptEl.focus();
    } else {
      formMode = 'prompt'; formModeBar.className = 'form-mode-bar'; promptEl.placeholder = 'Ask Orion...';
    }
  }
  formModeCancel.addEventListener('click', () => setFormMode('prompt'));

  // ── New Task Sheet ────────────────────────────────
  function openSheet() {
    sheetOverlay.classList.add('open');
    newTaskSheet.classList.add('open');
    rebuildProjGrid();
    sheetPrompt.value = '';
    setTimeout(() => sheetPrompt.focus(), 320);
  }
  function closeSheet() {
    sheetOverlay.classList.remove('open');
    newTaskSheet.classList.remove('open');
  }
  function selectSheetProject(path) {
    selectedSheetProject = path;
    projGrid.querySelectorAll('.proj-tile').forEach(t => t.classList.toggle('selected', t.dataset.path === path));
  }
  function rebuildProjGrid() {
    let html = '<div class="proj-tile standalone' + (selectedSheetProject === '' ? ' selected' : '') + '" data-path=""><div class="proj-tile-name">&#x2726; Standalone</div><div class="proj-tile-meta">No project workspace</div></div>';
    availableProjects.forEach(p => {
      const meta = p.conversationCount ? p.conversationCount + ' conversation' + (p.conversationCount === 1 ? '' : 's') : 'No conversations yet';
      html += '<div class="proj-tile' + (selectedSheetProject === p.path ? ' selected' : '') + '" data-path="' + escapeHtml(p.path) + '"><div class="proj-tile-name">' + escapeHtml(p.name) + '</div><div class="proj-tile-meta">' + escapeHtml(meta) + '</div></div>';
    });
    projGrid.innerHTML = html;
    projGrid.querySelectorAll('.proj-tile').forEach(t => t.addEventListener('click', () => selectSheetProject(t.dataset.path)));
  }
  sheetOverlay.addEventListener('click', closeSheet);
  sheetClose.addEventListener('click', closeSheet);
  newTaskEl.addEventListener('click', () => {
    if (activeConversationMode === 'orion') enterDispatch({ fresh: true });
    else openSheet();
  });
  sheetStart.addEventListener('click', async () => {
    sheetStart.disabled = true;
    try {
      const sheetMode = selectedSheetProject ? 'coder' : companionMode;
      const res = await companionFetch('/api/conversations/new', { method: 'POST', body: JSON.stringify({ prompt: '', projectPath: selectedSheetProject, mode: sheetMode }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'New task failed');
      currentConversationId = data.conversationId || currentConversationId;
      closeSheet();
      const initialPrompt = sheetPrompt.value.trim();
      if (initialPrompt) {
        const pRes = await companionFetch('/api/prompt', { method: 'POST', body: JSON.stringify({ prompt: initialPrompt, projectPath: selectedSheetProject, mode: sheetMode }) });
        const pData = await pRes.json();
        if (!pData.success) showChatError(pData.error || \'Send failed\');
      }
      await loadState();
    } catch (err) {
      showChatError(err.message);
    } finally {
      sheetStart.disabled = false;
    }
  });

  // ── Quick action chips ────────────────────────────
  document.getElementById('chip-stop').addEventListener('click', () => stopTaskEl.click());
  newFocusChipEl.addEventListener('click', () => {
    if (activeConversationMode === 'orion') enterDispatch({ fresh: true });
    else openSheet();
  });
  document.getElementById('chip-copy-last').addEventListener('click', () => {
    const allMsgs = messagesEl.querySelectorAll('.message.assistant');
    if (!allMsgs.length) return;
    const txt = allMsgs[allMsgs.length - 1].innerText || allMsgs[allMsgs.length - 1].textContent;
    // navigator.clipboard requires a secure context (HTTPS/localhost).
    // The phone companion runs over plain HTTP so we fall back to execCommand.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).catch(() => {});
    } else {
      try {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {}
    }
  });

  // ── Utility ───────────────────────────────────────

  function showChatError(errMessage) {
    statusEl.textContent = errMessage;
    if (messagesEl) {
      // Don't stack an identical error bubble on top of the same one -- a retried action that
      // keeps failing should update in place, not grow the transcript.
      const lastChild = messagesEl.lastElementChild;
      if (lastChild && lastChild.classList.contains('error') && lastChild.textContent.includes(errMessage)) {
        return;
      }
      const errDiv = document.createElement('div');
      errDiv.className = 'message system error';
      errDiv.innerHTML = '<div class="message-content" style="color: #ff5555; font-weight: 500;">&#9888; ' + escapeHtml(errMessage) + '</div>';
      messagesEl.appendChild(errDiv);
      // Only follow the new bubble down if the user is already at the bottom -- never steal the
      // scroll position from someone who has scrolled up to read.
      if (userPinnedToBottom && !touchActive) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }

  // ── Switch conversation ───────────────────────────
  async function switchTask(taskId) {
    if (!taskId) return;
    // Invalidate any in-flight loadState so stale responses don't win
    ++stateRequestSerial;
    // Lock the intended destination before the POST completes. An SSE payload that was already
    // in flight for the prior Dispatch/Coder conversation must not navigate the phone backward.
    pendingConversationSelectionId = taskId;
    statusEl.textContent = 'Switching console view...';
    try {
      const res = await companionFetch('/api/conversations/switch', { method: 'POST', body: JSON.stringify({ conversationId: taskId }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Switch failed');
      acceptedConversationSelectionRevision = Math.max(acceptedConversationSelectionRevision, Number(data.selectionRevision) || 0);
      currentConversationId = data.conversationId || taskId;
      userPinnedToBottom = true; // a freshly opened conversation should land at the bottom
      // Re-capture serial after POST so any polls during the switch request don't beat us
      const serial = ++stateRequestSerial;
      await loadState({ minSerial: serial, force: true });
      // Re-derive role chrome from the accepted server state at the switch boundary. This makes
      // the completed switch authoritative even if an earlier SSE snapshot finished rendering
      // during the POST/load handoff.
      updateSpecialistTabVisibility(activeConversationMode);
      updateDrawerState();
      // Navigate to Chat tab so the user lands in the conversation
      switchTab('panel-chat');
    } catch (error) {
      pendingConversationSelectionId = '';
      showChatError(error.message);
    }
  }
  window.switchTask = switchTask;

  function clearNotificationConversationFromUrl() {
    const url = new URL(location.href);
    if (!url.searchParams.has('conversation')) return;
    url.searchParams.delete('conversation');
    history.replaceState(null, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
  }

  async function applyPendingNotificationConversation() {
    const conversationId = String(pendingNotificationConversationId || '');
    if (!conversationId || !deviceSession) return false;
    const response = await companionFetch('/api/conversations/switch', {
      method: 'POST',
      body: JSON.stringify({ conversationId })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Could not open the notification conversation.');
    acceptedConversationSelectionRevision = Math.max(acceptedConversationSelectionRevision, Number(result.selectionRevision) || 0);
    currentConversationId = result.conversationId || conversationId;
    pendingConversationSelectionId = currentConversationId;
    pendingNotificationConversationId = '';
    userPinnedToBottom = true;
    clearNotificationConversationFromUrl();
    switchTab('panel-chat');
    return true;
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
      const data = event.data || {};
      if (data.type !== 'orion-notification-open' || !data.conversationId) return;
      const notificationConversationId = String(data.conversationId);
      if (deviceSession) {
        pendingNotificationConversationId = '';
        switchTask(notificationConversationId).then(() => {
          clearNotificationConversationFromUrl();
        });
      } else {
        pendingNotificationConversationId = notificationConversationId;
        loadState({ force: true });
      }
    });
  }

  // data-switch-task delegation (for status tab task rows only)
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const switchRow = target.closest('[data-switch-task]');
    if (switchRow) {
      switchTask(switchRow.getAttribute('data-switch-task') || '');
    }
    // Deny plan inline from attention card
    const denyBtn = target.closest('[data-deny-plan]');
    if (denyBtn) {
      const convId = denyBtn.getAttribute('data-deny-plan') || '';
      if (!convId) return;
      denyBtn.disabled = true;
      denyBtn.textContent = 'Denying…';
      companionFetch('/api/conversations/deny-plan', {
        method: 'POST',
        body: JSON.stringify({ conversationId: convId })
      }).then(() => loadState()).catch(() => {
        denyBtn.disabled = false;
        denyBtn.textContent = 'Deny';
      });
    }
  });

  // agent-logs expand/collapse
  document.addEventListener('click', event => {
    const header = event.target.closest('.agent-logs-header');
    if (!header) return;
    const container = header.closest('.agent-logs-container');
    if (!container) return;
    const isCollapsed = container.classList.toggle('collapsed');
    const btn = header.querySelector('span:last-child');
    if (btn) btn.textContent = isCollapsed ? 'show' : 'hide';
  });

  // ── Phone model + reasoning selectors ───────────────
  // The composer bar (above the input) and the Status-tab info card both pick the model; the
  // composer bar also picks the reasoning depth. All of them proxy the desktop's selection
  // through /api/model, so every surface always shows the same state.
  function fillModelOptions(select, models, current) {
    if (!select) return;
    select.innerHTML = '';
    const groups = {};
    models.forEach(m => {
      const g = m.group || 'Other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(m);
    });
    Object.entries(groups).forEach(([groupLabel, groupModels]) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = groupLabel;
      groupModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        optgroup.appendChild(opt);
      });
      select.appendChild(optgroup);
    });
    if (current) select.value = current;
  }

  function reflectReasoningSelection(level) {
    if (!composerReasoningSelect) return;
    const value = level || 'auto';
    if (Array.from(composerReasoningSelect.options).some(o => o.value === value)) {
      composerReasoningSelect.value = value;
    }
    composerReasoningSelect.classList.toggle('reasoning-forced', value !== 'auto');
  }

  async function loadPhoneModelList() {
    if (!phoneModelSelect && !composerModelSelect) return;
    try {
      const res = await companionFetch('/api/model');
      const data = await res.json();
      if (!data.success || !Array.isArray(data.models)) return;
      const current = data.current || '';
      // Option LISTS are always rebuilt — they are the available choices, not the selection.
      // The selected VALUES go through the same pending guard the status poll uses, so a
      // re-read cannot undo a local pick the desktop has not applied yet. When this runs right
      // after a successful POST the fetched value matches what is pending, which satisfies the
      // guard and releases it in a single round trip.
      const incomingReasoning = data.reasoning || 'auto';
      const displayedReasoning = composerReasoningSelect ? composerReasoningSelect.value : 'auto';
      if (composerReasoningSelect && Array.isArray(data.reasoningLevels) && data.reasoningLevels.length) {
        composerReasoningSelect.innerHTML = '';
        data.reasoningLevels.forEach(levelOption => {
          const opt = document.createElement('option');
          opt.value = levelOption.value;
          opt.textContent = '🧠 ' + levelOption.label;
          composerReasoningSelect.appendChild(opt);
        });
      }
      const modelSuppressed = syncSuppressed('model', current, data.selectionRevisions);
      fillModelOptions(phoneModelSelect, data.models, modelSuppressed ? phoneModelSelect && phoneModelSelect.value : current);
      fillModelOptions(composerModelSelect, data.models, modelSuppressed ? composerModelSelect && composerModelSelect.value : current);
      if (!syncSuppressed('reasoning', incomingReasoning, data.selectionRevisions)) {
        reflectReasoningSelection(incomingReasoning);
      } else if (composerReasoningSelect) {
        // Rebuilding the option list cleared the rendered selection, so the pending local pick
        // (or the last revision-approved value) is re-applied rather than silently falling back
        // to the list's first entry.
        reflectReasoningSelection(pendingSelection.reasoning
          ? pendingSelection.reasoning.value
          : displayedReasoning);
      }
    } catch (e) {
      console.warn('Could not load model list:', e.message);
    }
  }

  async function postModelSelection(body, failureLabel) {
    try {
      const res = await companionFetch('/api/model', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!data.success) {
        statusEl.textContent = failureLabel + ': ' + (data.error || 'unknown error');
        await loadPhoneModelList(); // revert to the desktop's actual state
      } else {
        acknowledgeSelectionResponse(body.model ? 'model' : 'reasoning', data);
        // Re-read the desktop's state immediately. That echo satisfies the pending guard, so
        // it releases in one round trip instead of blocking real desktop-side changes until
        // the next scheduled poll or the TTL.
        loadPhoneModelList().catch(() => {});
      }
      return data;
    } catch (e) {
      statusEl.textContent = e.message;
      return { success: false, error: e.message };
    }
  }

  // ── Optimistic-selection guard ──────────────────────
  // The desktop is the source of truth and status polls continuously push its state down. That
  // creates a race the user always loses: pick Ultra, and a poll issued BEFORE the POST landed
  // arrives carrying the desktop's old 'auto' and snaps the control back. It reads as "the app
  // refuses to keep my selection".
  //
  // A focus/blur flag does not fix this. Mobile browsers open a native picker for <select>, and
  // focus/blur around it is inconsistent — blur can fire before the change is committed, which
  // reopens the same window. So the guard is the VALUE itself: a locally-chosen value is held
  // until the desktop echoes it back, and incoming sync for that field is ignored until then.
  const pendingSelection = { model: null, reasoning: null };
  const acceptedSelectionRevision = { model: 0, reasoning: 0 };
  // The guard must be SHORT. It has to outlive the in-flight POST — clearing the instant the
  // POST resolves is unsafe, because a poll issued before the desktop applied the change can
  // still land afterwards carrying the old value. But while it is held, a genuine desktop-side
  // change is ignored, so the window is bounded three ways: the desktop echoing the value back
  // (normal case, usually the very next poll), a forced re-read right after the POST resolves
  // so that echo arrives promptly, and this deadline as the final backstop for a lost response.
  const PENDING_SELECTION_TTL_MS = 8000;

  function markPending(field, value) {
    pendingSelection[field] = { value, at: Date.now() };
  }
  function clearPending(field) {
    pendingSelection[field] = null;
  }
  function selectionRevision(field, revisions) {
    return Math.max(0, Number(revisions && revisions[field]) || 0);
  }
  function acknowledgeSelectionResponse(field, data) {
    const revision = selectionRevision(field, data && data.selectionRevisions);
    if (revision > acceptedSelectionRevision[field]) acceptedSelectionRevision[field] = revision;
    const pending = pendingSelection[field];
    const responseValue = field === 'model' ? data && data.model : data && data.reasoning;
    // New servers return a durable monotonically increasing revision. Once the POST response
    // acknowledges that revision, the optimistic hold can end: any older poll is rejected by
    // revision even if it arrives later. Older servers retain the value/TTL fallback below.
    if (revision > 0 && pending && responseValue === pending.value) pendingSelection[field] = null;
  }
  function shouldRejectSelectionRevision(acceptedRevision, incomingRevision) {
    const accepted = Math.max(0, Number(acceptedRevision) || 0);
    const incoming = Math.max(0, Number(incomingRevision) || 0);
    // Once this page has observed a versioned selection, revision 0 is not "legacy truth";
    // it is an older response that was issued before the first persisted selection revision.
    return accepted > 0 && incoming < accepted;
  }
  function syncSuppressed(field, incomingValue, revisions) {
    const revision = selectionRevision(field, revisions);
    if (shouldRejectSelectionRevision(acceptedSelectionRevision[field], revision)) return true;
    if (revision > acceptedSelectionRevision[field]) {
      acceptedSelectionRevision[field] = revision;
      // A strictly newer desktop revision wins over any older local pending selection.
      pendingSelection[field] = null;
    }
    const pending = pendingSelection[field];
    if (!pending) return false;
    if (Date.now() - pending.at > PENDING_SELECTION_TTL_MS) {
      pendingSelection[field] = null;
      return false;
    }
    // Once the desktop echoes the value back, the round trip is complete and sync resumes.
    if (incomingValue === pending.value) {
      pendingSelection[field] = null;
      return false;
    }
    return true;
  }

  function wirePhoneModelSelect(select, otherSelect) {
    if (!select) return;
    select.addEventListener('change', async () => {
      const model = select.value;
      if (!model) return;
      markPending('model', model);
      select.disabled = true;
      try {
        const data = await postModelSelection({ model }, 'Model change failed');
        if (data.success) {
          if (otherSelect && Array.from(otherSelect.options).some(o => o.value === model)) {
            otherSelect.value = model;
          }
        } else {
          clearPending('model');
        }
      } finally {
        select.disabled = false;
      }
    });
  }
  wirePhoneModelSelect(phoneModelSelect, composerModelSelect);
  wirePhoneModelSelect(composerModelSelect, phoneModelSelect);

  if (composerReasoningSelect) {
    composerReasoningSelect.addEventListener('change', async () => {
      const reasoning = composerReasoningSelect.value || 'auto';
      markPending('reasoning', reasoning);
      // Reflected immediately so the control shows the choice while the round trip is in
      // flight, rather than appearing to do nothing for a beat.
      reflectReasoningSelection(reasoning);
      composerReasoningSelect.disabled = true;
      try {
        const data = await postModelSelection({ reasoning }, 'Reasoning change failed');
        if (data.success) {
          reflectReasoningSelection(data.reasoning || reasoning);
        } else {
          // A rejected change reverts to the desktop's real state rather than showing a
          // selection that was never applied.
          clearPending('reasoning');
          await loadPhoneModelList();
        }
      } finally {
        composerReasoningSelect.disabled = false;
      }
    });
  }

  // Load selections once on boot
  if (phoneModelSelect || composerModelSelect) loadPhoneModelList();

  // ── Clarifying-questions chat card ─────────────────
  // Mirrors the desktop's buildClarificationCardHtml (renderer.js), but renders inside the
  // scrollable transcript so long forms can be reached above the composer and bottom nav.
  function clarificationDraftKey(state) {
    const source = state || lastLoadedState || {};
    const clarification = source.awaitingClarification || {};
    const questions = Array.isArray(clarification.questions) ? clarification.questions : [];
    if (!questions.length) return '';
    return JSON.stringify([
      source.conversationId || currentConversationId || '',
      clarification.taskId || '',
      questions.map(question => [
        question.header || '',
        question.question || '',
        (Array.isArray(question.options) ? question.options : []).map(option => option.label || '')
      ])
    ]);
  }

  function getClarificationDraft(state, create) {
    const key = clarificationDraftKey(state);
    if (!key) return null;
    if (!clarificationDrafts.has(key) && create) {
      // Keep this bounded if the user moves among several conversations with unanswered cards.
      if (clarificationDrafts.size >= 20) clarificationDrafts.delete(clarificationDrafts.keys().next().value);
      clarificationDrafts.set(key, { key, answers: {} });
    }
    return clarificationDrafts.get(key) || null;
  }

  function captureClarificationDraft(card, state) {
    if (!card) return;
    const draft = getClarificationDraft(state, true);
    if (!draft) return;
    card.querySelectorAll('.clarification-question-block[data-qi]').forEach(block => {
      const qi = block.getAttribute('data-qi');
      const checked = block.querySelector('input[type="radio"]:checked');
      const otherInput = block.querySelector('.clarification-other-input');
      if (!checked && !otherInput?.value) return;
      draft.answers[qi] = {
        selected: checked ? checked.value : '',
        other: otherInput ? otherInput.value : ''
      };
    });
  }

  function restoreClarificationDraft(card, state) {
    const draft = getClarificationDraft(state, false);
    if (!card || !draft) return;
    Object.keys(draft.answers).forEach(qi => {
      const answer = draft.answers[qi] || {};
      const block = card.querySelector('.clarification-question-block[data-qi="' + qi + '"]');
      if (!block) return;
      const radios = Array.from(block.querySelectorAll('input[type="radio"]'));
      const selected = radios.find(radio => radio.value === answer.selected);
      if (selected) selected.checked = true;
      const otherInput = block.querySelector('.clarification-other-input');
      if (otherInput) otherInput.value = answer.other || '';
    });
  }

  function renderClarificationMessage(clarData) {
    if (!clarData) return '';
    const questions = Array.isArray(clarData.questions) ? clarData.questions : [];
    const questionsHtml = questions.map((q, qi) => {
      const optionsHtml = (Array.isArray(q.options) ? q.options : []).map((opt, oi) => {
        const recommendedBadge = opt.recommended ? '<span class="clarification-recommended-badge">Recommended</span>' : '';
        const descHtml = opt.description ? '<span class="clarification-option-desc">' + escapeHtml(opt.description) + '</span>' : '';
        return '<label class="clarification-option">' +
          '<input type="radio" name="clarq_' + qi + '" value="' + oi + '" />' +
          '<span class="clarification-option-body">' +
          '<span class="clarification-option-label-row"><span class="clarification-option-label">' + escapeHtml(opt.label || '') + '</span>' + recommendedBadge + '</span>' +
          descHtml +
          '</span></label>';
      }).join('');
      return '<div class="clarification-question-block" data-qi="' + qi + '">' +
        '<div class="clarification-question-header">' +
        '<span class="clarification-chip">' + escapeHtml(q.header || '') + '</span>' +
        '<span class="clarification-question-text">' + escapeHtml(q.question || '') + '</span>' +
        '</div>' +
        '<div class="clarification-options">' + optionsHtml +
        '<label class="clarification-other-row">' +
        '<input type="radio" name="clarq_' + qi + '" value="__other__" />' +
        '<input class="clarification-other-input" type="text" placeholder="Other — type your answer…" data-qi="' + qi + '" />' +
        '</label></div></div>';
    }).join('');
    return '<div class="message assistant clarification-message" data-clarification-card="true">' +
      (clarData.intro ? '<div class="clarification-intro">' + escapeHtml(clarData.intro) + '</div>' : '') +
      questionsHtml +
      '<div class="clarification-actions"><button class="btn-clarification-submit" type="button">Submit</button></div>' +
      '</div>';
  }

  async function submitClarificationFromTranscript(button) {
    const state = lastLoadedState || {};
    const questions = Array.isArray((state.awaitingClarification || {}).questions) ? state.awaitingClarification.questions : [];
    const card = button ? button.closest('[data-clarification-card="true"]') : null;
    captureClarificationDraft(card, state);
    const answers = [];
    let allAnswered = true;
    let firstUnanswered = null;
    questions.forEach((q, qi) => {
      const block = card ? card.querySelector('.clarification-question-block[data-qi="' + qi + '"]') : null;
      let answer = null;
      if (block) {
        const checked = block.querySelector('input[type="radio"][name="clarq_' + qi + '"]:checked');
        if (checked) {
          if (checked.value === '__other__') {
            const otherInput = block.querySelector('.clarification-other-input[data-qi="' + qi + '"]');
            answer = otherInput ? otherInput.value.trim() : '';
          } else {
            const optIdx = parseInt(checked.value, 10);
            answer = (q.options[optIdx] && q.options[optIdx].label) || '';
          }
        }
      }
      if (!answer) {
        allAnswered = false;
        if (!firstUnanswered) firstUnanswered = block;
        if (block) {
          block.classList.add('unanswered');
          block.setAttribute('aria-invalid', 'true');
        }
      } else if (block) {
        block.classList.remove('unanswered');
        block.removeAttribute('aria-invalid');
      }
      answers.push({ header: q.header, question: q.question, answer: answer || '(no answer)' });
    });

    if (!allAnswered) {
      if (button) {
        const orig = button.textContent;
        button.textContent = 'Answer all questions first';
        setTimeout(() => { button.textContent = orig; }, 1800);
      }
      if (firstUnanswered) {
        firstUnanswered.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const firstControl = firstUnanswered.querySelector('input[type="radio"], .clarification-other-input');
        if (firstControl) setTimeout(() => firstControl.focus({ preventScroll: true }), 260);
      }
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = 'Submitting…';
    }
    try {
      const res = await companionFetch('/api/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Submission failed');
      const draftKey = clarificationDraftKey(state);
      if (draftKey) clarificationDrafts.delete(draftKey);
      await loadState();
    } catch (error) {
      showChatError(error.message);
      if (button) {
        button.disabled = false;
        button.textContent = 'Submit';
      }
    }
  }

  messagesEl.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const dispatchPrompt = target.closest('[data-dispatch-prompt]');
    if (dispatchPrompt) {
      promptEl.value = dispatchPrompt.getAttribute('data-dispatch-prompt') || '';
      promptEl.dispatchEvent(new Event('input'));
      promptEl.focus();
      return;
    }
    const submitButton = target.closest('.btn-clarification-submit');
    if (submitButton) {
      submitClarificationFromTranscript(submitButton);
      return;
    }
    const row = target.closest('.clarification-option, .clarification-other-row');
    if (!row) return;
    const radio = row.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
    const block = row.closest('.clarification-question-block');
    if (block) {
      block.classList.remove('unanswered');
      block.removeAttribute('aria-invalid');
    }
    captureClarificationDraft(row.closest('[data-clarification-card="true"]'), lastLoadedState);
  });

  messagesEl.addEventListener('focusin', event => {
    const target = event.target;
    if (!(target instanceof Element) || !target.classList.contains('clarification-other-input')) return;
    const row = target.closest('.clarification-other-row');
    const radio = row ? row.querySelector('input[type="radio"]') : null;
    if (radio) radio.checked = true;
  });

  messagesEl.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof Element) || !target.classList.contains('clarification-other-input')) return;
    const row = target.closest('.clarification-other-row');
    const radio = row ? row.querySelector('input[type="radio"]') : null;
    if (radio) radio.checked = true;
    const block = row ? row.closest('.clarification-question-block') : null;
    if (block) {
      block.classList.remove('unanswered');
      block.removeAttribute('aria-invalid');
    }
    captureClarificationDraft(target.closest('[data-clarification-card="true"]'), lastLoadedState);
  });

  // ── State loader ──────────────────────────────────
  let lastRenderedConversationId = '';
  let chatImageObjectUrls = [];

  function releaseChatImageObjectUrls() {
    chatImageObjectUrls.forEach(url => URL.revokeObjectURL(url));
    chatImageObjectUrls = [];
  }

  function renderMessageImages(images, defaultConversationId) {
    return (Array.isArray(images) ? images : []).slice(0, 4).map(img => {
      if (!img) return '';
      const conversationId = img.sourceConversationId || defaultConversationId || '';
      const alt = escapeHtml(img.alt || 'attached image');
      const caption = img.caption ? '<figcaption>' + escapeHtml(img.caption) + '</figcaption>' : '';
      if (img.data && img.mimeType) {
        return '<figure class="message-image-figure"><img class="message-image" src="data:' + escapeHtml(img.mimeType) + ';base64,' + img.data + '" alt="' + alt + '">' + caption + '</figure>';
      }
      if (!img.path) return '';
      return '<figure class="message-image-figure"><img class="message-image" data-chat-image-path="' + escapeHtml(img.path) + '" data-chat-image-conversation="' + escapeHtml(conversationId || '') + '" alt="' + alt + '"><span class="message-image-status">Loading image…</span>' + caption + '</figure>';
    }).join('');
  }

  async function loadMessageImage(image, attempt = 0) {
      if (!image || !image.isConnected || image.getAttribute('src')) return;
      if (image.dataset.loading === 'true' || image.getAttribute('src')) return;
      image.dataset.loading = 'true';
      const figure = image.closest('.message-image-figure');
      const status = figure ? figure.querySelector('.message-image-status') : null;
      if (status) status.textContent = attempt > 0 ? 'Retrying image…' : 'Loading image…';
      try {
        const path = image.getAttribute('data-chat-image-path') || '';
        const conversationId = image.getAttribute('data-chat-image-conversation') || '';
        const response = await companionFetch('/api/chat-image?conversationId=' + encodeURIComponent(conversationId) + '&path=' + encodeURIComponent(path), {
          headers: { Accept: 'image/*' }
        });
        if (!response.ok) throw new Error('Image unavailable');
        const objectUrl = URL.createObjectURL(await response.blob());
        chatImageObjectUrls.push(objectUrl);
        image.src = objectUrl;
        image.dataset.loading = 'false';
        if (status) status.remove();
      } catch (_) {
        image.dataset.loading = 'false';
        if (!image.isConnected) return;
        if (attempt < 2) {
          const delay = attempt === 0 ? 400 : 1200;
          window.setTimeout(() => loadMessageImage(image, attempt + 1), delay);
          return;
        }
        if (status) {
          status.textContent = 'Image unavailable — tap to retry';
          status.onclick = () => {
            status.onclick = null;
            loadMessageImage(image, 0);
          };
        }
      }
  }

  function hydrateMessageImages() {
    messagesEl.querySelectorAll('img[data-chat-image-path]').forEach(image => {
      loadMessageImage(image, 0);
    });
  }

  const imageLightbox = document.getElementById('image-lightbox');
  const imageLightboxViewport = document.getElementById('image-lightbox-viewport');
  const imageLightboxImage = document.getElementById('image-lightbox-image');
  const imageLightboxTitle = document.getElementById('image-lightbox-title');
  const imageLightboxZoomLabel = document.getElementById('image-lightbox-zoom');
  let imageLightboxZoom = 1;

  function setImageLightboxZoom(value) {
    imageLightboxZoom = Math.min(8, Math.max(1, Number(value) || 1));
    const zoomed = imageLightboxZoom > 1;
    if (imageLightboxViewport) imageLightboxViewport.classList.toggle('zoomed', zoomed);
    if (imageLightboxImage) {
      imageLightboxImage.style.width = zoomed ? (imageLightboxZoom * 100) + '%' : 'auto';
      imageLightboxImage.style.maxWidth = zoomed ? 'none' : '100%';
      imageLightboxImage.style.maxHeight = zoomed ? 'none' : '100%';
    }
    if (imageLightboxZoomLabel) imageLightboxZoomLabel.textContent = Math.round(imageLightboxZoom * 100) + '%';
  }

  function openImageLightbox(image) {
    const source = image && (image.currentSrc || image.getAttribute('src'));
    if (!source || !imageLightbox || !imageLightboxImage) return;
    imageLightboxImage.src = source;
    imageLightboxImage.alt = image.getAttribute('alt') || 'Expanded chat image';
    if (imageLightboxTitle) imageLightboxTitle.textContent = image.getAttribute('alt') || 'Chat image';
    setImageLightboxZoom(1);
    imageLightbox.classList.add('open');
  }

  function closeImageLightbox() {
    if (!imageLightbox) return;
    imageLightbox.classList.remove('open');
    if (imageLightboxImage) imageLightboxImage.removeAttribute('src');
    setImageLightboxZoom(1);
  }

  messagesEl.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const image = target.closest('.message-image');
    if (image) openImageLightbox(image);
  });
  document.getElementById('image-lightbox-close').addEventListener('click', closeImageLightbox);
  document.getElementById('image-lightbox-fit').addEventListener('click', () => setImageLightboxZoom(1));
  document.getElementById('image-lightbox-zoom-out').addEventListener('click', () => setImageLightboxZoom(imageLightboxZoom / 1.5));
  document.getElementById('image-lightbox-zoom-in').addEventListener('click', () => setImageLightboxZoom(imageLightboxZoom * 1.5));
  imageLightboxImage.addEventListener('dblclick', () => setImageLightboxZoom(imageLightboxZoom > 1 ? 1 : 2));
  imageLightbox.addEventListener('click', event => {
    if (event.target === imageLightbox) closeImageLightbox();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && imageLightbox && imageLightbox.classList.contains('open')) closeImageLightbox();
  });

  function renderDispatchEmptyState() {
    return '<div class="dispatch-empty-chat">' +
      '<div class="dispatch-empty-title">' + escapeHtml(dispatchGreeting()) + '</div>' +
      '<div class="dispatch-empty-status">No task is too large. What are we taking on?</div>' +
      '<div class="dispatch-empty-actions">' +
        '<button class="dispatch-empty-action" type="button" data-dispatch-prompt="What is Coder working on right now?">Check active work</button>' +
        '<button class="dispatch-empty-action" type="button" data-dispatch-prompt="What did we work on last time?">Pick up where we left off</button>' +
        '<button class="dispatch-empty-action" type="button" data-dispatch-prompt="Help me think through ">Think something through</button>' +
      '</div>' +
    '</div>';
  }

  function renderConversationMessages(state) {
    // Capture in-progress answers before a poll-driven transcript rebuild destroys the old DOM.
    captureClarificationDraft(messagesEl.querySelector('[data-clarification-card="true"]'), lastLoadedState);
    let messages = Array.isArray(state.messages) ? state.messages : [];
    if (optimisticPhoneSend && Date.now() - optimisticPhoneSend.createdAt < 120000) {
      const canonicalMessageArrived = messages.some(msg =>
        msg && msg.role === 'user'
        && ((msg.requestId && msg.requestId === optimisticPhoneSend.requestId)
          || (!msg.requestId
            && (msg.text || msg.content || '') === optimisticPhoneSend.text
            && (!msg.createdAt || Math.abs(Number(msg.createdAt) - optimisticPhoneSend.createdAt) < 120000)))
      );
      if (canonicalMessageArrived) {
        optimisticPhoneSend = null;
      } else {
        messages = messages.concat([{
          role: 'user',
          source: 'phone-optimistic',
          text: optimisticPhoneSend.text,
          images: optimisticPhoneSend.images,
          phoneSendState: optimisticPhoneSend.stage === 'preparing'
            ? 'Received · preparing context…'
            : 'Sending…',
          createdAt: optimisticPhoneSend.createdAt
        }]);
      }
    }
    const wasLoading = isShowingLoadingPlaceholder();
    const isConversationSwitch = (state.conversationId || '') !== lastRenderedConversationId;
    const signature = JSON.stringify({
      id: state.conversationId || '',
      mode: state.mode || '',
      running: !!state.running,
      sub: state.subStatus || '',
      plan: !!state.awaitingPlanApproval,
      clarification: state.awaitingClarification || null,
      msgs: messages
    });
    if (signature === lastSignature) return;
    // While the user's finger is down, or they've scrolled up to read, the DOM belongs to them.
    // Rebuilding innerHTML mid-gesture destroys the touch drag/momentum (trapping them at the
    // bottom), and rebuilding while they're reading up top shifts content under them. Stash the
    // newest state and apply it when they return to the bottom / lift their finger. A
    // conversation switch or initial load still renders immediately.
    if (!wasLoading && !isConversationSwitch && (touchActive || !userPinnedToBottom)) {
      pendingRenderState = state;
      return;
    }
    const wasNearBottom = userPinnedToBottom;
    lastSignature = signature;
    lastRenderedConversationId = state.conversationId || '';
    const isDispatchConversation = state.mode === 'orion';
    // Anchor to the TOP (stable scrollTop), not distance-from-bottom. New assistant text is
    // appended at the bottom, so preserving distance-from-bottom would drag the view downward to
    // keep that gap as the bottom grows -- pulling the reader away from the older message they
    // scrolled up to read. The content above the reader isn't changing height, so keeping
    // scrollTop constant keeps that message visually fixed. (Clamped below in case the list got
    // shorter than the old offset, which can only happen right near the bottom anyway.)
    const oldScrollTop = messagesEl.scrollTop;
    // Deduplicate consecutive identical user messages — a repeated tap can result in
    // the same message being stored twice; only the first occurrence should render.
    const dedupedMessages = messages.filter((msg, i) => {
      if (i === 0 || msg.role !== 'user') return true;
      const prev = messages[i - 1];
      return !(prev.role === 'user' && (prev.text || prev.content || '') === (msg.text || msg.content || ''));
    });
    const renderedMessages = dedupedMessages.map(msg => {
          const messageText = msg.text || msg.content || '';
          const logsHtml = msg.role === 'assistant'
            ? (isDispatchConversation ? renderDispatchToolActivity(msg.logs || []) : renderToolCallRows(msg.logs || []))
            : '';
          const split = msg.role === 'assistant' ? splitAssistantOutput(messageText) : { answer: messageText, walkthrough: '' };
          const walkthroughHtml = msg.role === 'assistant' ? renderWorkWalkthroughBlock(split.walkthrough) : '';
          const hasActivity = !!(logsHtml || walkthroughHtml);
          const isThinkingOnly = msg.role === 'assistant' && isAssistantThinkingPlaceholder(split.answer);
          if (shouldHideAssistantThinkingPlaceholder(split.answer, hasActivity, state.running)) return '';
          const recoveredAnswer = recoverIdleAssistantPlaceholder(split.answer, hasActivity, state.running);
          if (recoveredAnswer) {
            // The run ended before any text or tool activity was saved for this turn. Show an
            // unobtrusive system-style note instead of an assistant bubble with error-sounding copy.
            return '<div class="message system">' + escapeHtml(recoveredAnswer) + '</div>';
          }
          const answerText = msg.role === 'assistant' ? (isThinkingOnly ? recoveredAnswer : split.answer) : messageText;
          // Both user uploads and Orion's conversation-scoped screenshot references render in
          // the transcript. Referenced images are fetched lazily through the paired/authenticated
          // companion endpoint so base64 data is never repeated in every state poll.
          const imagesHtml = renderMessageImages(msg.images, state.conversationId);
          const bodyHtml = msg.role === 'system'
            ? escapeHtml(messageText)
            : (answerText ? '<div class="message-answer">' + imagesHtml + renderMarkdown(answerText) + '</div>' : imagesHtml ? '<div class="message-answer">' + imagesHtml + '</div>' : '');
          const pendingStateHtml = msg.phoneSendState
            ? '<span class="phone-send-state">' + escapeHtml(msg.phoneSendState) + '</span>'
            : '';
          return '<div class="message ' + escapeHtml(msg.role) + (hasActivity ? ' has-activity' : '') + (msg.phoneSendState ? ' phone-send-pending' : '') + '"><span class="role">' + escapeHtml(msg.role) + '</span>' +
            logsHtml + walkthroughHtml + bodyHtml + pendingStateHtml + '</div>';
        }).filter(Boolean).join('');
    const clarificationHtml = state.awaitingClarification ? renderClarificationMessage(state.awaitingClarification) : '';
    const typingHtml = state.running ? renderInlineTypingIndicator() : '';
    releaseChatImageObjectUrls();
    messagesEl.innerHTML = (renderedMessages || clarificationHtml || typingHtml)
      ? renderedMessages + clarificationHtml + typingHtml
      : (isDispatchConversation ? renderDispatchEmptyState() : '<div class="empty">No messages yet.</div>');
    restoreClarificationDraft(messagesEl.querySelector('[data-clarification-card="true"]'), state);
    hydrateMessageImages();
    // Markdown-rendering cleanup: mirrors renderer.js's Prism.highlightAllUnder(bubble) call after
    // desktop message render. Prism itself may 404 (blocked network, packaged build without
    // node_modules/prismjs) — guarded the same way marked's own optional-asset failures are
    // tolerated elsewhere on this page, so a missing highlighter degrades to plain code text
    // instead of breaking the message render.
    if (typeof Prism !== 'undefined') {
      try { Prism.highlightAllUnder(messagesEl); } catch (_) { /* best-effort highlighting only */ }
    }
    if (wasLoading || wasNearBottom || isConversationSwitch) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
      userPinnedToBottom = true;
    } else {
      const newMaxScrollTop = Math.max(0, messagesEl.scrollHeight - messagesEl.clientHeight);
      messagesEl.scrollTop = Math.min(oldScrollTop, newMaxScrollTop);
    }
  }

  function renderToolCallRows(toolCalls) {
    if (!Array.isArray(toolCalls) || !toolCalls.length) return '';
    const rows = renderToolCallRowList(toolCalls);
    return '<div class="agent-logs-container">' +
      '<div class="agent-logs-header"><span>Execution Logs (' + toolCalls.length + ' operations)</span><span>hide</span></div>' +
      '<div class="agent-logs-body">' + rows + '</div>' +
    '</div>';
  }

  function renderDispatchToolActivity(toolCalls) {
    if (!Array.isArray(toolCalls) || !toolCalls.length) return '';
    const latest = toolCalls.slice().reverse().find(call => call && (call.tool || call.type === 'tool_call')) || toolCalls[toolCalls.length - 1];
    const rawStatus = String(latest.status || 'running').toLowerCase();
    const status = rawStatus === 'completed' ? 'success' : rawStatus;
    const verb = status === 'error' ? 'Trouble with' : (status === 'success' || status === 'done' ? 'Checked' : 'Using');
    const toolName = latest.tool || 'tool';
    return '<div class="agent-logs-container dispatch-activity-log collapsed">' +
      '<div class="agent-logs-header">' +
        '<span class="dispatch-current-tool"><span class="dispatch-tool-pulse"></span>' + escapeHtml(verb) + ' <code>' + escapeHtml(toolName) + '</code></span>' +
        '<span>show</span>' +
      '</div>' +
      '<div class="agent-logs-body">' + renderToolCallRowList(toolCalls) + '</div>' +
    '</div>';
  }

  function renderToolCallRowList(toolCalls) {
    return toolCalls.slice(-8).map(call => {
      const rawStatus = String(call.status || 'running').toLowerCase();
      const status = rawStatus === 'completed' ? 'success' : rawStatus;
      if (call.type === 'thought' && call.content) {
        return '<div class="thought-block"><strong>Thought:</strong> ' + escapeHtml(call.content) + '</div>';
      }
      const params = formatToolParams(call.params);
      const resultPreview = formatToolResultPreview(call.result);
      const result = resultPreview
        ? '<div class="tool-result-label">Result</div><div class="tool-result-box">' + escapeHtml(resultPreview) + '</div>'
        : '';
      return '<div class="tool-run-badge">' +
        '<div class="tool-call-info">' +
          '<span class="tool-name">' + escapeHtml(call.tool || 'tool') + '</span>' +
          '<span class="tool-status ' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>' +
        '</div>' +
        (params ? '<div class="tool-params">Params: ' + escapeHtml(params) + '</div>' : '') +
        result +
      '</div>';
    }).join('');
  }

  function truncateToolText(value, maxLength) {
    const text = String(value || '').trim();
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, maxLength).trimEnd() + '\\n...';
  }

  function tryParseToolJson(value) {
    if (!value || typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!/^[{\\[]/.test(trimmed)) return value;
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      return value;
    }
  }

  function formatToolParams(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return '';
    const entries = Object.entries(params)
      .filter(pair => pair[1] !== undefined && pair[1] !== null && String(pair[1]).trim() !== '')
      .slice(0, 5)
      .map(pair => {
        const key = pair[0];
        const value = typeof pair[1] === 'object'
          ? JSON.stringify(pair[1])
          : String(pair[1]);
        return key + ': ' + truncateToolText(value, 80).replace(/\\s+/g, ' ');
      });
    return truncateToolText(entries.join('  |  '), 260);
  }

  function summarizeFileListResult(result) {
    const lines = [];
    const files = Array.isArray(result.files) ? result.files : [];
    const omitted = Array.isArray(result.omitted) ? result.omitted : [];
    const totals = result.totals && typeof result.totals === 'object' ? result.totals : null;
    if (totals) {
      const parts = [];
      if (totals.returned !== undefined) parts.push(totals.returned + ' returned');
      if (totals.visible !== undefined) parts.push(totals.visible + ' visible');
      if (totals.hidden !== undefined) parts.push(totals.hidden + ' hidden');
      if (parts.length) lines.push('Workspace inventory: ' + parts.join(', ') + '.');
    } else if (files.length) {
      lines.push('Workspace inventory: ' + files.length + ' files returned.');
    }
    if (files.length) {
      lines.push('Files:');
      files.slice(0, 8).forEach(file => {
        const path = file && (file.path || file.name) ? (file.path || file.name) : String(file || '');
        lines.push('- ' + path);
      });
      if (files.length > 8) lines.push('- ... ' + (files.length - 8) + ' more');
    }
    if (omitted.length) {
      lines.push('Omitted: ' + omitted.slice(0, 4).map(item => item.path || item.reason || '').filter(Boolean).join(', ') + (omitted.length > 4 ? ', ...' : ''));
    }
    if (result.warning) lines.push('Warning: ' + result.warning);
    return lines.join('\\n');
  }

  function formatToolResultPreview(result) {
    if (result === undefined || result === null || result === '') return '';
    const parsed = tryParseToolJson(result);
    if (typeof parsed === 'string') return truncateToolText(parsed, 900);
    if (Array.isArray(parsed)) return truncateToolText(JSON.stringify(parsed.slice(0, 12), null, 2), 900);
    if (!parsed || typeof parsed !== 'object') return truncateToolText(String(parsed), 900);
    if (Array.isArray(parsed.files) || Array.isArray(parsed.omitted) || parsed.totals) {
      return truncateToolText(summarizeFileListResult(parsed), 900);
    }
    const lines = [];
    if (parsed.error) lines.push('Error: ' + parsed.error);
    if (parsed.message) lines.push(String(parsed.message));
    if (parsed.summary) lines.push(String(parsed.summary));
    if (parsed.warning) lines.push('Warning: ' + parsed.warning);
    if (parsed.path) lines.push('Path: ' + parsed.path);
    if (parsed.content) lines.push(truncateToolText(String(parsed.content), 700));
    if (parsed.stdout) lines.push('stdout:\\n' + truncateToolText(parsed.stdout, 700));
    if (parsed.stderr) lines.push('stderr:\\n' + truncateToolText(parsed.stderr, 700));
    if (!lines.length) lines.push(JSON.stringify(parsed, null, 2));
    return truncateToolText(lines.filter(Boolean).join('\\n'), 900);
  }

  async function emergencyFillMessages() {
    try {
      if (!messagesEl || !isShowingLoadingPlaceholder()) return;
      const res = await companionFetch('/api/state');
      if (!res.ok) return;
      const state = await res.json();
      if (state && state.success && Array.isArray(state.messages) && state.messages.length) {
        lastSignature = '';
        renderConversationMessages(state);
      }
    } catch (e) {}
  }

  async function loadState(options = {}) {
    // Guard BEFORE incrementing the serial — a no-op early return must not waste a serial slot.
    // Transport activity is not state freshness. SSE keepalives prove only that the socket is
    // alive; they must never suppress the fallback poll when no state payload has arrived. Use the
    // last accepted JSON state (from SSE or HTTP) as the freshness clock instead.
    if (!options.force && ((sseConnected && Date.now() - lastStatePayloadAt < PHONE_STATE_FRESHNESS_MS) || stateFetchController)) return;
    const requestSerial = options.minSerial || ++stateRequestSerial;
    // The SSE stream (startEventStream) is the primary update path; this poll is only a fallback
    // for when the stream hasn't delivered anything recently (not yet connected, or dropped).
    let requestController = null;
    let requestGeneration = 0;
    let requestTimeout = null;
    try {
      if (!deviceSession) {
        statusEl.textContent = 'Pairing with Orion...';
        statusPillEl.textContent = 'Pairing';
        const pairResult = await pairIfNeeded();
        if (!pairResult.success) {
          statusPillEl.textContent = pairResult.needsPairingLink ? 'Disconnected' : 'Pairing';
          if (pairResult.needsPairingLink) {
            statusEl.textContent = pairResult.message || 'This browser needs a fresh Orion pairing link.';
          } else if (!pairResult.pending) {
            statusEl.innerHTML = 'Pairing denied. <button class="btn-sm" onclick="location.reload()">Retry</button>';
          }
          return;
        }
        startEventStream({ force: true });
      }
      if (pendingNotificationConversationId) {
        await applyPendingNotificationConversation();
      }
      if (options.force && stateFetchController) stateFetchController.abort();
      requestController = new AbortController();
      requestGeneration = ++stateFetchGeneration;
      stateFetchController = requestController;
      requestTimeout = setTimeout(() => requestController.abort(), 7000);
      const res = await companionFetch('/api/state', {
        cache: 'no-store',
        signal: requestController.signal
      });
      if (res.status === 401) {
        let authFailure = null;
        try { authFailure = await res.json(); } catch (_) {}
        const permanentFailure = !!(
          authFailure &&
          authFailure.rePairRequired === true &&
          permanentCredentialFailureCodes.has(String(authFailure.code || ''))
        );
        if (!permanentFailure) {
          // A proxy, captive portal, stale service worker, or transient server startup can also
          // return 401. Keep the durable phone credential unless Orion explicitly identifies it.
          confirmedCredentialFailures = 0;
          statusEl.textContent = 'Connection interrupted. Retrying saved phone access...';
          return;
        }
        confirmedCredentialFailures += 1;
        if (confirmedCredentialFailures < 2) {
          statusEl.textContent = 'Verifying saved phone access...';
          setTimeout(() => loadState({ force: true }), 800);
          return;
        }
        localStorage.removeItem(sessionKey);
        deviceSession = null;
        statusPillEl.textContent = 'Disconnected';
        statusEl.textContent = authFailure.code === 'COMPANION_DEVICE_REVOKED'
          ? 'Phone access was revoked.'
          : 'Saved phone access is no longer recognized.';
        stopEventStream();
        return;
      }
      const state = await res.json();
      if (!state.success) throw new Error(state.error || 'Failed to load state');
      if (requestSerial < stateRequestSerial) return;
      lastStatePayloadAt = Date.now();
      confirmedCredentialFailures = 0;
      consecutiveStateFailures = 0;
      applyState(state);
    } catch (error) {
      // Foreground recovery deliberately aborts a request inherited from before the phone was
      // suspended. That request is obsolete, not a connection failure, and must not turn the
      // badge Offline while its replacement is already running.
      if (error && error.name === 'AbortError'
          && (requestGeneration !== stateFetchGeneration || document.hidden)) return;
      consecutiveStateFailures += 1;
      // A failed background poll is a status-bar event, NOT a chat event. showChatError appends
      // a bubble into the transcript and scrolls to the bottom -- with the poll retrying every
      // 3 seconds, a flaky/rate-limited connection turned that into a rhythmic yank-to-bottom
      // that made it impossible to scroll up and read while a task ran.
      if (consecutiveStateFailures >= 2) {
        showReconnectBanner('Still reconnecting… your last conversation is safe');
        // Connectivity is not task lifecycle. Preserve the last authoritative Ready/Acting/
        // Review/Completed state and show reconnection only in the dedicated connection badge.
        connBadgeEl.className = deviceSession ? 'conn-badge polling' : 'conn-badge offline';
        connTextEl.textContent = deviceSession
          ? machineName + ' · Reconnecting'
          : 'Disconnected';
        const dot = connBadgeEl.querySelector('.conn-dot');
        if (dot) dot.classList.toggle('pulse', !!deviceSession);
      }
    } finally {
      if (requestTimeout) clearTimeout(requestTimeout);
      if (stateFetchController === requestController) stateFetchController = null;
    }
  }

  function appendOptimisticPhoneMessage(text, images, requestId) {
    if (!messagesEl) return null;
    messagesEl.querySelectorAll(':scope > .empty, :scope > .dispatch-empty-chat').forEach(node => node.remove());
    const bubble = document.createElement('div');
    bubble.className = 'message user phone-send-pending';
    bubble.dataset.phoneRequestId = requestId || '';
    optimisticPhoneSend = {
      requestId: requestId || '',
      text,
      images: Array.isArray(images) ? images : [],
      stage: 'sending',
      createdAt: Date.now()
    };
    const imagesHtml = renderMessageImages(images, currentConversationId);
    bubble.innerHTML = '<span class="role">user</span><div class="message-answer">' +
      imagesHtml + renderMarkdown(text) + '</div><span class="phone-send-state">Sending\u2026</span>';
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    userPinnedToBottom = true;
    return bubble;
  }

  function settleOptimisticPhoneMessage(bubble, success) {
    if (!bubble || !bubble.isConnected) return;
    const state = bubble.querySelector('.phone-send-state');
    if (success) {
      if (optimisticPhoneSend) optimisticPhoneSend.stage = 'preparing';
      if (state) state.textContent = 'Received · preparing context…';
      return;
    }
    bubble.classList.remove('phone-send-pending');
    bubble.classList.add('phone-send-failed');
    optimisticPhoneSend = null;
    if (state) state.textContent = 'Could not send';
  }

  function applyState(state) {
      hideReconnectBanner();
      const pushInvalidatedAt = String(
        state && state.device && state.device.pushSubscriptionRefreshToken
        || state && state.device && state.device.pushSubscriptionInvalidatedAt
        || ''
      );
      if (state && state.device && state.device.pushSubscriptionNeedsRefresh === true
          && pushInvalidatedAt
          && pushInvalidatedAt !== lastPushRefreshAttemptAt) {
        lastPushRefreshAttemptAt = pushInvalidatedAt;
        // The push provider expired this endpoint. Renew it with the already-paired device
        // session; rotating a browser subscription must never require pairing again.
        setTimeout(() => setupPushNotifications({ forceRefresh: true }), 0);
      }
      const stateSelectionRevision = Math.max(0, Number(state && state.device && state.device.selectionRevision) || 0);
      const stateSelectedConversationId = String(
        state && state.device && state.device.selectedConversationId
        || state && state.conversationId
        || ''
      );
      // Conversation choice is user-owned UI state. Background execution updates may refresh the
      // selected transcript, but an older SSE/poll response may never choose a different one.
      if (stateSelectionRevision < acceptedConversationSelectionRevision) return;
      if (pendingConversationSelectionId
          && String(state && state.conversationId || '') !== pendingConversationSelectionId) return;
      if (stateSelectedConversationId
          && state && state.conversationId
          && stateSelectedConversationId !== String(state.conversationId)) return;
      acceptedConversationSelectionRevision = Math.max(acceptedConversationSelectionRevision, stateSelectionRevision);
      if (pendingConversationSelectionId === String(state && state.conversationId || '')) {
        pendingConversationSelectionId = '';
      }
      // A cold phone reload normally opens Dispatch's front door. Actionable conversation state is
      // the exception: hiding a pending plan/clarification behind a blank local draft leaves the
      // user looking at one view while controls from another conversation leak into it. Reopen the
      // exact selected Dispatch conversation when it needs input; ordinary idle launches still use
      // the clean landing page.
      const restoreSelectedDispatchConversation = !!(
        !initialScreenResolved
        && companionMode === 'orion'
        && state && state.mode === 'orion'
        && state.conversationId
        && (state.awaitingPlanApproval || state.awaitingClarification)
      );
      if (restoreSelectedDispatchConversation) {
        dispatchDraftActive = false;
        lastDispatchConversationId = String(state.conversationId);
      }
      // If the user triggered a restart/update, the first successful state response means Orion
      // came back up. Navigate home so the settings page doesn't stay stuck on disabled buttons.
      if (restartPending) {
        restartPending = false;
        // Reset any restart/update buttons that were left in a disabled "Restarting…" state
        if (restartAppBtn) {
          restartAppBtn.textContent = 'Restart';
          restartAppBtn.disabled = false;
        }
        if (updateApplyBtn) {
          updateApplyBtn.textContent = 'Update & Restart';
          updateApplyBtn.disabled = false;
        }
        if (updateCheckStatus) updateCheckStatus.textContent = 'Updated successfully ✓';
        showScreen('screen-home');
        return;
      }
      lastLoadedState = state;
      const preserveDispatchDraft = companionMode === 'orion' && dispatchDraftActive;
      if (!preserveDispatchDraft) {
        currentConversationId = state.conversationId || '';
        activeConversationMode = state.mode || 'orion';
        if (activeConversationMode === 'orion' && currentConversationId) {
          lastDispatchConversationId = currentConversationId;
        }
      } else {
        currentConversationId = '';
        activeConversationMode = 'orion';
      }
      if (newFocusChipEl) {
        newFocusChipEl.innerHTML = activeConversationMode === 'orion'
          ? '&#x1F504; New Focus'
          : '&#x1F504; New Task';
      }
      metaEl.textContent = preserveDispatchDraft ? 'Fresh Dispatch' : (state.title || 'No active conversation');
      if (modelEl) modelEl.textContent = state.model || '-';
      updateSpecialistTabVisibility(preserveDispatchDraft ? 'orion' : (state.mode || 'orion'));
      // Sync phone selects to the desktop's current state — unless the user just chose
      // something here and the desktop has not echoed it back yet. Without that check a poll
      // issued before the POST landed reverts the user's own selection.
      if (state.model && !syncSuppressed('model', state.model, state.selectionRevisions)) {
        [phoneModelSelect, composerModelSelect].forEach(select => {
          if (!select) return;
          if (!Array.from(select.options).some(o => o.value === state.model)) {
            // Model not in list yet — add it so the select always reflects reality
            const opt = document.createElement('option');
            opt.value = state.model;
            opt.textContent = state.model;
            select.appendChild(opt);
          }
          select.value = state.model;
        });
      }
      // A reasoning level picked on the desktop must show up here too — same guard, because
      // this was the field actually observed snapping back to Auto.
      if (state.reasoning && !syncSuppressed('reasoning', state.reasoning, state.selectionRevisions)) {
        reflectReasoningSelection(state.reasoning);
      }
      chatProjNameEl.textContent = preserveDispatchDraft ? 'Orion' : (state.title || 'Chat');
      if (!preserveDispatchDraft) renderConversationMessages(state);
      dispatchBrowseButton.classList.toggle('visible', activeConversationMode === 'orion');

      const viewingId = preserveDispatchDraft ? '' : state.conversationId;
      const viewingOwnsConversationState = !!(
        viewingId
        && String(state.conversationId || '') === String(viewingId)
      );
      const viewingAwaitingPlanApproval = !!(
        viewingOwnsConversationState
        && state.awaitingPlanApproval
      );
      const viewingConversationRunning = !!(
        viewingOwnsConversationState
        && state.running
      );
      const supervisedTask = activeConversationMode === 'orion'
        && window.OrionTaskOrchestration
        && typeof window.OrionTaskOrchestration.selectSupervisedTask === 'function'
        ? window.OrionTaskOrchestration.selectSupervisedTask(
            state.orchestrationTasks || [],
            viewingId,
            state.activeTaskId || '',
            { delegatedOnly: true, followDescendants: true }
          )
        : null;
      const supervisedPresentation = supervisedTask
        ? (window.OrionTaskOrchestration
          && typeof window.OrionTaskOrchestration.describeSupervisedTaskPresentation === 'function'
            ? window.OrionTaskOrchestration.describeSupervisedTaskPresentation(supervisedTask, {
                awaitingReview: viewingAwaitingPlanApproval || !!supervisedTask.awaitingReview,
                revisingPlan: !!supervisedTask.revisingPlan,
                planApproved: !!supervisedTask.planApproved,
                executionMode: supervisedTask.executionMode || '',
                subStatus: supervisedTask.subStatus || '',
                roleMode: supervisedTask.target && supervisedTask.target.mode || '',
                roleLabel: (() => {
                  const roleMode = supervisedTask.target && supervisedTask.target.mode;
                  const roleDefinition = companionSpecialistDefinition(roleMode);
                  return roleDefinition ? roleDefinition.label : 'Specialist';
                })()
              })
            : supervisedTask.presentation)
        : null;
      const phonePresentation = window.OrionTaskOrchestration
        && typeof window.OrionTaskOrchestration.resolvePhoneConversationPresentation === 'function'
        ? window.OrionTaskOrchestration.resolvePhoneConversationPresentation({
            conversationRunning: viewingConversationRunning,
            awaitingPlanApproval: viewingAwaitingPlanApproval,
            supervisedPresentation,
            subStatus: state.subStatus || '',
            executionMode: state.executionMode || '',
            liveRole: activeConversationMode,
            workspace: state.workspace || ''
          })
        : {
            agentState: viewingConversationRunning
              ? 'Thinking'
              : (viewingAwaitingPlanApproval
                ? 'Review'
                : (supervisedPresentation ? supervisedPresentation.agentState : 'Ready')),
            detail: viewingConversationRunning
              ? (state.subStatus || state.workspace || '')
              : (supervisedPresentation ? supervisedPresentation.detail : (state.subStatus || state.workspace || '')),
            isRunning: viewingConversationRunning || !!(supervisedPresentation && supervisedPresentation.isOngoing),
            useSupervisedTaskCard: !!(
              supervisedPresentation
              && (supervisedPresentation.isOngoing || !viewingConversationRunning)
            )
          };
      const intakeStatus = state && state.intakeStatus;
      statusPillEl.textContent = intakeStatus && !viewingConversationRunning
        ? (intakeStatus.label || 'Preparing')
        : phonePresentation.agentState;
      statusPillEl.classList.remove('connecting');
      statusPillEl.classList.toggle('running', phonePresentation.isRunning || !!intakeStatus);
      statusPillEl.classList.toggle('operator-active', phonePresentation.agentState === 'Operator active');
      statusEl.textContent = intakeStatus && !viewingConversationRunning
        ? (intakeStatus.detail || 'Understanding your request and gathering relevant memory…')
        : phonePresentation.detail;

      planPanelEl.dataset.conversationId = viewingAwaitingPlanApproval ? String(viewingId) : '';
      planPanelEl.classList.toggle('visible', viewingAwaitingPlanApproval);

      const runningId = state.runningConversationId;
      const globalRunning = !!state.globalRunning;
      const runningTaskObj = (state.conversations || []).find(c => c.id === runningId);

      if (supervisedPresentation && supervisedPresentation.isOngoing) {
        const supervisedRole = supervisedTask && supervisedTask.target && supervisedTask.target.mode;
        globalIndicatorBanner.className = supervisedRole === 'operator'
          ? 'indicator-banner operator-running'
          : 'indicator-banner active-running';
        globalIndicatorBanner.innerHTML = '<span>' + escapeHtml(supervisedPresentation.label) + ': <strong>'
          + escapeHtml(supervisedTask.title || 'Coder task') + '</strong></span>';
      } else if (globalRunning) {
        if (viewingId === runningId) {
          globalIndicatorBanner.className = 'indicator-banner active-running';
          globalIndicatorBanner.innerHTML = '<span>Viewing globally running task</span>';
        } else {
          const runningTitle = runningTaskObj ? runningTaskObj.title : 'Another Task';
          globalIndicatorBanner.className = 'indicator-banner background-running';
          globalIndicatorBanner.innerHTML = '<span>Running: <strong>' + escapeHtml(runningTitle) + '</strong></span><button data-switch-task="' + escapeHtml(runningId) + '">Switch View</button>';
        }
      } else {
        globalIndicatorBanner.className = 'indicator-banner idle';
        globalIndicatorBanner.innerHTML = '<span>Agent is idle</span>';
      }

      // Only show the "Coder working on…" banner if some Orion conversation still has this coder
      // task set as its active launched task. After notifySupervisorOfCoderCompletion runs,
      // launchedCoderConvId is cleared to null — so even if globalRunning is briefly stale,
      // the banner won't fire once the completion has been recorded.
      const showBackgroundCoder = !preserveDispatchDraft
        && activeConversationMode === 'orion'
        && supervisedTask
        && supervisedPresentation
        && supervisedPresentation.isOngoing;
      dispatchRunningBanner.classList.toggle('visible', !!showBackgroundCoder);
      if (showBackgroundCoder) {
        const supervisedRole = supervisedTask.target && supervisedTask.target.mode || 'coder';
        const supervisedDefinition = companionSpecialistDefinition(supervisedRole);
        const isDesktopControl = !!(supervisedDefinition && supervisedDefinition.canControlDesktop);
        const supervisedRoleLabel = supervisedDefinition ? supervisedDefinition.label : 'Specialist';
        dispatchRunningBanner.classList.toggle('operator-control', isDesktopControl);
        dispatchRunningBanner.setAttribute('data-conversation-id', supervisedTask.targetConversationId || '');
        dispatchRunningBanner.setAttribute('data-task-id', supervisedTask.taskId || '');
        dispatchRunningText.textContent = (supervisedRole === 'operator' ? 'Screen control · ' : '')
          + supervisedPresentation.label + ': ' + (supervisedTask.title || supervisedRoleLabel + ' task');
      } else {
        dispatchRunningBanner.classList.remove('operator-control');
        dispatchRunningBanner.removeAttribute('data-conversation-id');
        dispatchRunningBanner.removeAttribute('data-task-id');
      }

      // Active task card
      const activeConv = (state.conversations || []).find(c => c.id === viewingId);
      if (activeConv) {
        const hasSupervisedTask = !!(supervisedTask && supervisedPresentation);
        const useSupervisedTaskCard = hasSupervisedTask
          && phonePresentation.useSupervisedTaskCard;
        const isRunning = useSupervisedTaskCard
          ? supervisedPresentation.isOngoing
          : viewingConversationRunning;
        const statusText = useSupervisedTaskCard
          ? supervisedPresentation.label
          : (isRunning ? 'Running' : (activeConv.awaitingPlanApproval ? 'Needs Attention' : 'Idle'));
        const badgeClass = useSupervisedTaskCard
          ? supervisedPresentation.badgeClass
          : (isRunning ? 'success' : (activeConv.awaitingPlanApproval ? 'warning' : 'muted'));
        activeTaskContainer.innerHTML =
          '<div class="card-header">' +
          '<span style="font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:var(--accent);">Current Task View</span>' +
          '<div style="display:flex;gap:5px;"><span class="badge ' + badgeClass + (isRunning && (!supervisedPresentation || supervisedPresentation.phase !== 'review') ? ' pulse' : '') + '">' + escapeHtml(statusText) + '</span><span class="badge active-view">Viewing</span></div>' +
          '</div>' +
          '<div class="card-title">' + escapeHtml(useSupervisedTaskCard ? supervisedTask.title : activeConv.title) + '</div>' +
          '<div class="substatus-text">' + escapeHtml(useSupervisedTaskCard ? supervisedPresentation.detail : (state.subStatus || state.workspace || '')) + '</div>';
        chatProjNameEl.textContent = activeConv.title || 'Chat';
      } else {
        activeTaskContainer.innerHTML = '<div class="empty">No task selected</div>';
        chatProjNameEl.textContent = 'Chat';
      }

      renderPhoneTaskList(preserveDispatchDraft ? [] : (state.tasks || []));

      // Needs-attention cards -- scoped to whichever mode (Dispatch/Coder) the open conversation
      // belongs to, so a Dispatch chat never surfaces a Coder plan waiting for approval and vice versa.
      const viewMode = preserveDispatchDraft ? 'orion' : (state.mode || 'orion');
      const attentionTasks = (state.conversations || []).filter(c => c.awaitingPlanApproval && (c.mode || 'orion') === viewMode);
      if (attentionTasks.length > 0) {
        attentionTasksContainer.innerHTML = attentionTasks.map(c => {
          const isViewing = c.id === viewingId;
          return '<div class="status-card attention-card" style="margin-bottom:8px;">' +
            '<div class="card-header"><span class="badge warning">Plan Awaiting Approval</span>' +
            (isViewing ? '<span class="badge active-view">Viewing</span>' : '') + '</div>' +
            '<div class="card-title">' + escapeHtml(c.title) + '</div>' +
            '<div style="margin-top:8px; display:flex; gap:8px;">' +
            (isViewing ? '' : '<button class="btn-sm" data-switch-task="' + escapeHtml(c.id) + '">Switch to Approve</button>') +
            '<button class="btn-sm" data-deny-plan="' + escapeHtml(c.id) + '" style="background:rgba(239,68,68,0.12); border-color:rgba(239,68,68,0.35); color:#f87171;">Deny</button>' +
            '</div></div>';
        }).join('');
      } else {
        attentionTasksContainer.innerHTML = '';
      }

      // Queued prompts
      if (state.queuedPrompts > 0) {
        queuedPromptsContainer.innerHTML =
          '<div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:var(--accent);margin-bottom:7px;">Queued (' + state.queuedPrompts + ')</div>' +
          '<div class="queued-list">' + (state.queuedPromptPreview || []).map(p => '<div class="queued-item">' + escapeHtml(p) + '</div>').join('') + '</div>';
        queuedPromptsContainer.style.display = 'block';
      } else {
        queuedPromptsContainer.style.display = 'none';
      }

      // Recent tasks list (scoped to the open conversation's mode) + all conversations for home screen
      allConversations = state.conversations || [];
      const modeScopedTasks = allConversations.filter(c => (c.mode || 'orion') === viewMode);
      if (modeScopedTasks.length > 0) {
        recentTasksList.innerHTML = modeScopedTasks.map(c => {
          const isViewing = c.id === viewingId;
          const isRunning = globalRunning && c.id === runningId;
          const isAwaiting = !!c.awaitingPlanApproval;
          let badgesHtml = '';
          if (isViewing)  badgesHtml += '<span class="badge active-view">Viewing</span>';
          if (isRunning)  badgesHtml += '<span class="badge success pulse">Running</span>';
          if (isAwaiting) badgesHtml += '<span class="badge warning">Attention</span>';
          if (!isViewing && !isRunning && !isAwaiting) badgesHtml += '<span class="badge muted">Ready</span>';
          const timeText = new Date(c.updatedAt || 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return '<div class="task-row' + (isViewing ? ' active-row' : '') + '" data-switch-task="' + escapeHtml(c.id) + '">' +
            '<div style="flex:1;min-width:0;overflow:hidden;">' +
            '<div class="task-row-title">' + escapeHtml(c.title) + '</div>' +
            '<div class="task-row-meta">Updated: ' + timeText + ' &middot; ' + escapeHtml(c.discussionSummary || conversationActivityLabel(c)) + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;padding-left:8px;">' + badgesHtml + '</div>' +
            '</div>';
        }).join('');
      } else {
        recentTasksList.innerHTML = '<div class="empty">No tasks yet.</div>';
      }

      // Projects list
      const projects = Array.isArray(state.projects) ? state.projects : [];
      availableProjects = projects;
      projectCountBadgeEl.textContent = projects.length + (projects.length === 1 ? ' Project' : ' Projects');
      const projectOptionsSignature = JSON.stringify(projects.map(p => p.path));
      if (projectOptionsSignature !== lastProjectOptionsSignature) {
        projectSelectEl.innerHTML = '<option value="">Standalone conversation</option>' +
          projects.map(p => '<option value="' + escapeHtml(p.path) + '">' + escapeHtml(p.name) + '</option>').join('');
        lastProjectOptionsSignature = projectOptionsSignature;
      }

      // Logs tab
      const preview = state.preview || {};
      const outputHtml = renderToolCallRows(preview.latestToolCalls || []) +
        '<div class="latest-output-card">' + escapeHtml(preview.latestAssistantOutput || 'No assistant output yet.') + '</div>';
      document.getElementById('tab-output').innerHTML = outputHtml;
      document.getElementById('tab-walkthrough').innerHTML = preview.workWalkthrough
        ? renderWorkWalkthroughBlock(preview.workWalkthrough)
        : 'No walkthrough yet.';
      const filesPane = document.getElementById('tab-files');
      const changedFiles = preview.changedFiles;
      if (Array.isArray(changedFiles) && changedFiles.length) {
        filesPane.innerHTML = changedFiles.map(f => {
          const name = String(f).replace(/\\\\/g, '/').split('/').pop() || f;
          return '<div class="file-dl-row">' +
            '<span class="file-dl-name" title="' + escapeHtml(f) + '">' + escapeHtml(name) + '</span>' +
            '<button class="file-dl-btn" data-dl-path="' + escapeHtml(f) + '">&#x2B07; Download</button>' +
            '</div>';
        }).join('');
        filesPane.addEventListener('click', async function handleFileDl(e) {
          const btn = e.target.closest('[data-dl-path]');
          if (!btn) return;
          const path = btn.getAttribute('data-dl-path');
          if (!path) return;
          btn.textContent = '…';
          btn.disabled = true;
          try {
            const res = await companionFetch('/api/files/read?path=' + encodeURIComponent(path));
            if (!res.ok) throw new Error('Not found');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = path.replace(/\\\\/g, '/').split('/').pop() || 'file';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          } catch (err) {
            alert('Could not download: ' + err.message);
          } finally {
            btn.textContent = '⬇ Download';
            btn.disabled = false;
          }
        });
      } else { filesPane.textContent = 'No changed files recorded.'; }
      const testsPane = document.getElementById('tab-tests');
      const testResults = preview.testResults;
      if (Array.isArray(testResults) && testResults.length) {
        testsPane.innerHTML = testResults.map(r => '<div class="test-result-block">' + escapeHtml(r) + '</div>').join('');
      } else { testsPane.textContent = 'No test results recorded.'; }
      const launchUrlContainer = document.getElementById('launch-url-container');
      if (preview.appLaunchUrl) {
        launchUrlContainer.innerHTML = '<strong>Launch URL:</strong> <a href="' + escapeHtml(preview.appLaunchUrl) + '" target="_blank" style="color:var(--accent);text-decoration:underline;">' + escapeHtml(preview.appLaunchUrl) + '</a>';
      } else { launchUrlContainer.textContent = 'No app launch URL.'; }
      document.getElementById('launch-logs-container').textContent = preview.appLaunchLogs || 'No launch logs yet.';

      // Contextual controls
      ctxRunning.classList.toggle('visible', !!state.running);
      ctxIdle.classList.toggle('visible', !state.running);

      // Home screen refresh
      updateHomeScreen(state);
      if (preserveDispatchDraft) renderDispatchLanding(state);
      if (currentScreen === 'screen-project') renderProjectScreen();
      if (!initialScreenResolved) {
        initialScreenResolved = true;
        if (companionMode === 'orion' && !restoreSelectedDispatchConversation) {
          setTimeout(() => startDispatchDraft(), 0);
        }
      }
  }

  // ── Plan actions ──────────────────────────────────
  approvePlanEl.addEventListener('click', async () => {
    approvePlanEl.disabled = true;
    const orig = approvePlanEl.textContent;
    approvePlanEl.textContent = 'Starting…';
    try {
      const conversationId = String(planPanelEl.dataset.conversationId || '');
      if (!conversationId) throw new Error('This plan is no longer attached to the open conversation.');
      const res = await companionFetch('/api/approve-plan', {
        method: 'POST',
        body: JSON.stringify({ conversationId })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Approval failed');
      approvePlanEl.classList.add('approved');
      approvePlanEl.textContent = '✓ Started';
      await loadState();
    } catch (error) {
      showChatError(error.message);
      approvePlanEl.disabled = false;
      approvePlanEl.textContent = orig;
    }
  });
  denyPlanEl.addEventListener('click', async () => {
    denyPlanEl.disabled = true;
    const orig = denyPlanEl.textContent;
    denyPlanEl.textContent = 'Denying…';
    try {
      const conversationId = String(planPanelEl.dataset.conversationId || '');
      if (!conversationId) throw new Error('This plan is no longer attached to the open conversation.');
      const res = await companionFetch('/api/deny-plan', {
        method: 'POST',
        body: JSON.stringify({ conversationId })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Deny failed');
      await loadState();
    } catch (error) {
      showChatError(error.message);
    } finally {
      denyPlanEl.disabled = false;
      denyPlanEl.textContent = orig;
    }
  });
  revisePlanEl.addEventListener('click', () => {
    const conversationId = String(planPanelEl.dataset.conversationId || '');
    if (!conversationId) {
      showChatError('This plan is no longer attached to the open conversation.');
      return;
    }
    setFormMode('revise', conversationId);
  });
  refreshStateEl.addEventListener('click', loadState);
  steerTaskEl.addEventListener('click', () => setFormMode('steer'));

  stopTaskEl.addEventListener('click', async () => {
    stopTaskEl.disabled = true;
    statusEl.textContent = 'Stopping...';
    try {
      const res = await companionFetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Stop failed');
      await loadState();
    } catch (error) { showChatError(error.message); }
    finally { stopTaskEl.disabled = false; }
  });

  resumeTaskEl.addEventListener('click', async () => {
    resumeTaskEl.disabled = true;
    statusEl.textContent = 'Resuming...';
    try {
      const res = await companionFetch('/api/resume', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Resume failed');
      await loadState();
    } catch (error) { showChatError(error.message); }
    finally { resumeTaskEl.disabled = false; }
  });

  // ── Prompt form ───────────────────────────────────
  // Use an explicit click handler on the button (type="button") rather than the form's submit
  // event. On iOS/Android, a single tap on a type="submit" button can fire the submit event
  // twice (touchend → synthesized click, plus native form submit), bypassing the in-flight guard.
  // With type="button" + an explicit handler there is exactly one code path for submission.
  async function handlePromptSubmit() {
    if (promptSubmitInFlight) return; // block double-submit
    const text = promptEl.value.trim();
    if (!text) return;
    promptSubmitInFlight = true;
    userPinnedToBottom = true; // sending a message should show it, even if reading up higher
    const sendEl = document.getElementById('send');
    sendEl.disabled = true;
    sendEl.classList.add('sending');
    statusEl.textContent = 'Sending...';
    let optimisticBubble = null;
    try {
      if (formMode === 'steer') {
        const res = await companionFetch('/api/steer', {
          method: 'POST',
          body: JSON.stringify({
            prompt: text,
            conversationId: currentConversationId,
            selectionRevision: acceptedConversationSelectionRevision
          })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Steer failed');
        setFormMode('prompt');
      } else if (formMode === 'revise') {
        if (!formTargetConversationId) throw new Error('This plan is no longer attached to the open conversation.');
        const res = await companionFetch('/api/revise-plan', {
          method: 'POST',
          body: JSON.stringify({ feedback: text, conversationId: formTargetConversationId })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Revision failed');
        setFormMode('prompt');
      } else {
        const promptPayload = {
          prompt: text,
          requestId: 'phone_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9),
          // Bind the submission to the transcript the user can actually see. The server keeps its
          // own durable device selection, but that state can advance while a reconnect/SSE update
          // is in flight. Sending both values lets it reject a stale view instead of silently
          // filing the turn (and its answer) into a different conversation.
          conversationId: currentConversationId,
          selectionRevision: acceptedConversationSelectionRevision
        };
        const optimisticImages = phoneImageData
          ? [{ data: phoneImageData, mimeType: phoneImageMimeType || 'image/jpeg', alt: 'attached image' }]
          : [];
        // Rendering the user's own message is local UI work. Do it before the network request;
        // the server may spend several seconds classifying or answering this turn before the POST
        // resolves, and waiting for that response made the user bubble and AI answer appear at once.
        optimisticBubble = appendOptimisticPhoneMessage(text, optimisticImages, promptPayload.requestId);
        promptEl.value = '';
        promptEl.style.height = 'auto';
        if (phoneImageData) {
          promptPayload.imageData = phoneImageData;
          promptPayload.imageMimeType = phoneImageMimeType || 'image/jpeg';
        }
        if (phoneFileContent) {
          promptPayload.fileContent = phoneFileContent;
          promptPayload.fileName = phoneFileName || 'file.txt';
        }
        let res;
        if (dispatchDraftActive && companionMode === 'orion') {
          promptPayload.mode = 'orion';
          promptPayload.dispatchProjectPath = dispatchDraftProjectPath;
          promptPayload.contextSummary = dispatchDraftContextSummary;
          res = await companionFetch('/api/conversations/new', { method: 'POST', body: JSON.stringify(promptPayload) });
        } else {
          res = await companionFetch('/api/prompt', { method: 'POST', body: JSON.stringify(promptPayload) });
        }
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Send failed');
        settleOptimisticPhoneMessage(optimisticBubble, true);
        acceptedConversationSelectionRevision = Math.max(acceptedConversationSelectionRevision, Number(data.selectionRevision) || 0);
        if (data.conversationId) {
          currentConversationId = data.conversationId;
          pendingConversationSelectionId = data.conversationId;
          if (companionMode === 'orion') {
            dispatchDraftActive = false;
            lastDispatchConversationId = data.conversationId;
          }
          chatProjNameEl.textContent = text.length > 40 ? text.substring(0, 40) + '...' : text;
          if (data.processing) {
            statusPillEl.textContent = 'Preparing';
            statusPillEl.classList.remove('connecting');
            statusPillEl.classList.add('running');
            statusEl.textContent = 'Understanding your request and gathering relevant memory…';
          }
        }
        clearPhoneImage();
        clearPhoneFile();
      }
      promptEl.value = '';
      await loadState();
    } catch (error) {
      settleOptimisticPhoneMessage(optimisticBubble, false);
      if (!promptEl.value) {
        promptEl.value = text;
        promptEl.dispatchEvent(new Event('input'));
      }
      showChatError(error.message);
    } finally {
      promptSubmitInFlight = false;
      sendEl.disabled = false;
      sendEl.classList.remove('sending');
    }
  }
  document.getElementById('send').addEventListener('click', handlePromptSubmit);
  // Prevent the form from doing a native submit (e.g. if Enter is pressed) — all submission
  // goes through handlePromptSubmit above.
  form.addEventListener('submit', (e) => e.preventDefault());
  promptEl.addEventListener('input', () => {
    promptEl.style.height = 'auto';
    promptEl.style.height = Math.min(promptEl.scrollHeight, 110) + 'px';
  });

  // ── Log sub-tabs ──────────────────────────────────
  document.querySelectorAll('.log-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.log-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.getAttribute('data-tab')).classList.add('active');
    });
  });

  // ── PWA install prompt ────────────────────────────
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installTipEl.classList.add('visible');
    installTipEl.textContent = 'Installable! Open your browser menu and choose "Add to Home Screen".';
  });

  // ── Companion fetch (with auth headers) ───────────
  async function companionFetch(url, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (deviceSession) {
      headers.Authorization = 'Bearer ' + deviceSession.secret;
      headers['X-Orion-Device-Id'] = deviceSession.deviceId;
    }
    return fetch(url, Object.assign({}, options, { headers }));
  }

  // ── Real-time push (SSE) ──────────────────────────
  // Native EventSource can't send the Authorization/X-Orion-Device-Id headers companionFetch
  // uses, so this streams /api/events manually via fetch() + a reader instead. Falls back to the
  // 3s poll in loadState() whenever this hasn't delivered a message recently (not connected yet,
  // or the connection dropped).
  let sseActive = false;
  let eventStreamController = null;
  let eventStreamGeneration = 0;
  let eventStreamRetryTimer = null;

  function stopEventStream() {
    eventStreamGeneration += 1;
    if (eventStreamRetryTimer) clearTimeout(eventStreamRetryTimer);
    eventStreamRetryTimer = null;
    if (eventStreamController) eventStreamController.abort();
    eventStreamController = null;
    sseActive = false;
    sseConnected = false;
    sseStateReceived = false;
    refreshConnBadge();
  }

  function scheduleEventStreamReconnect(generation, delay = 1500) {
    if (generation !== eventStreamGeneration || document.hidden) return;
    if (eventStreamRetryTimer) clearTimeout(eventStreamRetryTimer);
    eventStreamRetryTimer = setTimeout(() => {
      eventStreamRetryTimer = null;
      if (generation === eventStreamGeneration && !document.hidden) startEventStream();
    }, delay);
  }

  async function startEventStream(options = {}) {
    if (!deviceSession) {
      // An authenticated stream cannot recover a missing session. The previous retry loop kept
      // repainting "Reconnecting" forever and hid the actionable pairing state. Pairing/session
      // recovery owns this transition and starts SSE after trust has been restored.
      if (eventStreamRetryTimer) clearTimeout(eventStreamRetryTimer);
      eventStreamRetryTimer = null;
      sseActive = false;
      sseConnected = false;
      refreshConnBadge();
      return;
    }
    if (sseActive && !options.force) return;
    if (options.force) stopEventStream();
    if (eventStreamRetryTimer) clearTimeout(eventStreamRetryTimer);
    eventStreamRetryTimer = null;
    const generation = ++eventStreamGeneration;
    const controller = new AbortController();
    eventStreamController = controller;
    sseActive = true;
    sseStateReceived = false;
    refreshConnBadge();
    try {
      const res = await companionFetch('/api/events', {
        cache: 'no-store',
        signal: controller.signal
      });
      if (!res.ok || !res.body) throw new Error('SSE unavailable');
      sseConnected = true;
      lastSseActivityAt = Date.now();
      hideReconnectBanner();
      refreshConnBadge();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Comments/keepalives are real connection activity too. Counting only JSON data frames
        // made the 3-second fallback poll hammer a perfectly healthy stream whenever state was
        // unchanged, multiplying expensive renderer snapshots and delaying the update it wanted.
        lastSseActivityAt = Date.now();
        buffer += decoder.decode(value, { stream: true });
        let sepIndex;
        while ((sepIndex = buffer.indexOf('\\n\\n')) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const dataLines = rawEvent.split('\\n').filter(line => line.startsWith('data:'));
          if (!dataLines.length) continue;
          try {
            const state = JSON.parse(dataLines.map(line => line.slice(5).trim()).join('\\n'));
            if (state && state.success) {
              lastSseMessageAt = Date.now();
              lastStatePayloadAt = lastSseMessageAt;
              sseStateReceived = true;
              consecutiveStateFailures = 0;
              applyState(state);
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      // Connection dropped/unsupported; loadState()'s 3s poll covers updates until reconnected.
    } finally {
      if (generation !== eventStreamGeneration) return;
      eventStreamController = null;
      sseActive = false;
      sseConnected = false;
      refreshConnBadge();
      scheduleEventStreamReconnect(generation);
    }
  }

  // ── Pairing ───────────────────────────────────────
  let isPairing = false;
  async function recoverSavedTailnetSession() {
    try {
      const res = await fetch('/api/session/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: '{}'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.device || !data.sessionSecret) {
        return { success: false, code: String(data.code || '') };
      }
      deviceSession = { deviceId: data.device.id, secret: data.sessionSecret };
      localStorage.setItem(sessionKey, JSON.stringify(deviceSession));
      confirmedCredentialFailures = 0;
      statusEl.textContent = 'Saved phone access restored';
      statusPillEl.textContent = 'Connecting';
      return { success: true, recovered: true };
    } catch (_) {
      return { success: false, code: 'COMPANION_RECOVERY_UNAVAILABLE' };
    }
  }

  async function pairIfNeeded() {
    if (deviceSession) return { success: true };
    if (isPairing) return { success: false, pending: true };
    isPairing = true;
    try {
      const params = new URLSearchParams(location.search);
      const urlPairingCode = params.get('pair') || '';
      if (!urlPairingCode) {
        const recovered = await recoverSavedTailnetSession();
        if (recovered.success) return recovered;
        const message = recovered.code === 'COMPANION_TRUSTED_ORIGIN_REQUIRED'
          ? "This shortcut is using the old phone address. Open Orion's current secure phone link once to migrate saved access."
          : 'This browser has no saved Orion phone access. Open the current pairing link once.';
        statusEl.textContent = message;
        return { success: false, pending: false, needsPairingLink: true, message };
      }
      const code = urlPairingCode;
      const name = (navigator.userAgent || 'Phone').slice(0, 64);
      let res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode: code, deviceName: name })
      });
      let data = await res.json();
      if (!data.success) {
        const needsPairingLink = res.status === 401 || data.code === 'COMPANION_PAIRING_CODE_INVALID';
        const message = needsPairingLink
          ? 'This pairing link expired. Open the current pairing link from Orion once; saved access will work after that.'
          : (data.error || 'Pairing pending or denied');
        statusEl.textContent = message;
        return {
          success: false,
          pending: !needsPairingLink && data.pending !== false,
          needsPairingLink,
          message
        };
      }
      deviceSession = { deviceId: data.device.id, secret: data.sessionSecret };
      localStorage.setItem(sessionKey, JSON.stringify(deviceSession));
      if (location.search) {
        history.replaceState(null, '', location.pathname || '/');
      }
      statusEl.textContent = 'Connected';
      return { success: true };
    } catch (err) {
      statusEl.textContent = 'Connection error: ' + err.message;
      return { success: false, pending: true };
    } finally {
      isPairing = false;
    }
  }

  // ── Attach picker (image + file) ──────────────────
  const phoneImgCamera   = document.getElementById('phone-img-camera');
  const phoneImgGallery  = document.getElementById('phone-img-gallery');
  const phoneFileInput   = document.getElementById('phone-file-input');
  const phoneImgPreview  = document.getElementById('phone-img-preview');
  const phoneImgThumb    = document.getElementById('phone-img-thumb');
  const phoneImgRemove   = document.getElementById('phone-img-remove');
  const phoneFilePreview = document.getElementById('phone-file-preview');
  const phoneFileNameEl  = document.getElementById('phone-file-name');
  const phoneFileRemove  = document.getElementById('phone-file-remove');
  const attachImageBtn   = document.getElementById('attach-image-btn');
  const attachSheetOverlay = document.getElementById('attach-sheet-overlay');

  function clearPhoneImage() {
    phoneImageData = null;
    phoneImageMimeType = null;
    if (phoneImgThumb) phoneImgThumb.src = '';
    if (phoneImgPreview) phoneImgPreview.style.display = 'none';
    if (attachImageBtn) attachImageBtn.classList.remove('has-image');
    if (phoneImgCamera) phoneImgCamera.value = '';
    if (phoneImgGallery) phoneImgGallery.value = '';
  }

  function clearPhoneFile() {
    phoneFileContent = null;
    phoneFileName = null;
    if (phoneFilePreview) phoneFilePreview.style.display = 'none';
    if (attachImageBtn) attachImageBtn.classList.remove('has-image');
    if (phoneFileInput) phoneFileInput.value = '';
  }

  function closeAttachSheet() {
    if (attachSheetOverlay) attachSheetOverlay.classList.remove('open');
  }

  function handleImageFile(file) {
    if (!file) return;
    clearPhoneFile();
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx === -1) return;
      phoneImageData = dataUrl.slice(commaIdx + 1);
      phoneImageMimeType = file.type || 'image/jpeg';
      if (phoneImgThumb) phoneImgThumb.src = dataUrl;
      if (phoneImgPreview) phoneImgPreview.style.display = 'flex';
      if (attachImageBtn) attachImageBtn.classList.add('has-image');
    };
    reader.readAsDataURL(file);
  }

  function handleTextFile(file) {
    if (!file) return;
    clearPhoneImage();
    const reader = new FileReader();
    reader.onload = e => {
      phoneFileContent = e.target.result;
      phoneFileName = file.name;
      if (phoneFileNameEl) phoneFileNameEl.textContent = file.name;
      if (phoneFilePreview) phoneFilePreview.style.display = 'flex';
      if (attachImageBtn) attachImageBtn.classList.add('has-image');
    };
    reader.readAsText(file);
  }

  if (attachImageBtn && attachSheetOverlay) {
    attachImageBtn.addEventListener('click', () => {
      // If already has attachment, clicking again clears it
      if (phoneImageData || phoneFileContent) {
        clearPhoneImage();
        clearPhoneFile();
        return;
      }
      attachSheetOverlay.classList.add('open');
    });
  }

  if (attachSheetOverlay) {
    attachSheetOverlay.addEventListener('click', e => {
      if (e.target === attachSheetOverlay) closeAttachSheet();
    });
    document.getElementById('attach-sheet-cancel').addEventListener('click', closeAttachSheet);
    document.getElementById('sheet-camera-btn').addEventListener('click', () => {
      closeAttachSheet();
      if (phoneImgCamera) phoneImgCamera.click();
    });
    document.getElementById('sheet-gallery-btn').addEventListener('click', () => {
      closeAttachSheet();
      if (phoneImgGallery) phoneImgGallery.click();
    });
    document.getElementById('sheet-file-btn').addEventListener('click', () => {
      closeAttachSheet();
      if (phoneFileInput) phoneFileInput.click();
    });
  }

  if (phoneImgCamera) {
    phoneImgCamera.addEventListener('change', () => handleImageFile(phoneImgCamera.files && phoneImgCamera.files[0]));
  }
  if (phoneImgGallery) {
    phoneImgGallery.addEventListener('change', () => handleImageFile(phoneImgGallery.files && phoneImgGallery.files[0]));
  }
  if (phoneFileInput) {
    phoneFileInput.addEventListener('change', () => handleTextFile(phoneFileInput.files && phoneFileInput.files[0]));
  }
  if (phoneImgRemove) {
    phoneImgRemove.addEventListener('click', clearPhoneImage);
  }
  if (phoneFileRemove) {
    phoneFileRemove.addEventListener('click', clearPhoneFile);
  }

  // ── Update checker ────────────────────────────────
  const updateBanner      = document.getElementById('update-banner');
  const updateBannerTxt   = document.getElementById('update-banner-text');
  const updateApplyBtn    = document.getElementById('update-apply-btn');
  const updateCheckStatus = document.getElementById('update-check-status');
  const updateCheckNowBtn = document.getElementById('update-check-now-btn');

  async function checkForUpdate({ manual = false } = {}) {
    if (!deviceSession) return;
    if (manual && updateCheckNowBtn) { updateCheckNowBtn.textContent = 'Checking…'; updateCheckNowBtn.disabled = true; }
    if (manual && updateCheckStatus) updateCheckStatus.textContent = 'Checking for updates…';
    try {
      const res = await companionFetch('/api/check-update');
      if (!res.ok) return;
      const data = await res.json();
      if (data.hasUpdate && updateBanner) {
        const changedFiles = data.changedCount > 0 ? ' (' + data.changedCount + ' local file' + (data.changedCount === 1 ? '' : 's') + ')' : '';
        if (updateBannerTxt) updateBannerTxt.textContent = 'Update available' + changedFiles;
        updateBanner.classList.add('visible');
        if (updateCheckStatus) updateCheckStatus.textContent = 'Update available!';
      } else {
        if (updateCheckStatus) updateCheckStatus.textContent = 'Up to date · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch (e) {
      if (manual && updateCheckStatus) updateCheckStatus.textContent = 'Check failed — are you online?';
    } finally {
      if (updateCheckNowBtn) { updateCheckNowBtn.textContent = 'Check Now'; updateCheckNowBtn.disabled = false; }
    }
  }

  if (updateCheckNowBtn) {
    updateCheckNowBtn.addEventListener('click', () => checkForUpdate({ manual: true }));
  }

  const restartAppBtn = document.getElementById('restart-app-btn');
  if (restartAppBtn) {
    restartAppBtn.addEventListener('click', async () => {
      restartAppBtn.textContent = 'Restarting…';
      restartAppBtn.disabled = true;
      restartPending = true;
      try {
        await companionFetch('/api/restart', { method: 'POST' });
      } catch (_) { /* expected — Orion exits mid-response */ }
    });
  }

  if (updateApplyBtn) {
    updateApplyBtn.addEventListener('click', async () => {
      updateApplyBtn.disabled = true;
      updateApplyBtn.textContent = 'Updating…';
      restartPending = true;
      try {
        await companionFetch('/api/apply-update', { method: 'POST' });
        if (updateBannerTxt) updateBannerTxt.textContent = 'Restarting…';
      } catch (e) {
        restartPending = false;
        updateApplyBtn.disabled = false;
        updateApplyBtn.textContent = 'Update & Restart';
        if (updateBannerTxt) updateBannerTxt.textContent = 'Update failed: ' + e.message;
      }
    });
  }

  // ── Push notifications ─────────────────────────────
  const notifBanner   = document.getElementById('notif-banner');
  const notifBannerText = document.getElementById('notif-banner-text');
  const notifEnableBtn = document.getElementById('notif-enable-btn');

  function setNotificationBanner(message, buttonText, enabled) {
    if (notifBannerText) notifBannerText.textContent = message;
    if (notifEnableBtn) {
      notifEnableBtn.textContent = buttonText || 'Enable';
      notifEnableBtn.disabled = enabled === false;
      notifEnableBtn.style.display = enabled === false ? 'none' : '';
    }
    if (notifBanner) notifBanner.classList.add('visible');
  }

  function hideNotificationBanner() {
    if (notifBanner) notifBanner.classList.remove('visible');
  }

  let pushSessionWaitAttempts = 0;
  let lastPushRefreshAttemptAt = '';
  let pushRefreshInFlight = false;

  async function setupPushNotifications(options = {}) {
    if (pushRefreshInFlight) return;
    pushRefreshInFlight = true;
    try {
      if (!deviceSession || !deviceSession.secret || !deviceSession.deviceId) {
        // This used to retry every second forever and show NOTHING — no banner, no error. A
        // device session is per-origin (it lives in localStorage), so pairing over the LAN
        // http:// URL does not carry over to the https:// tailnet URL. The user then opens the
        // secure URL, is never asked about notifications, and has no way to find out why.
        pushSessionWaitAttempts += 1;
        if (pushSessionWaitAttempts <= 20) {
          setTimeout(setupPushNotifications, 1000);
          return;
        }
        setNotificationBanner(
          'This device is not paired on this address yet. Pair it here (Phone button on the desktop) '
          + 'to enable notifications — pairing does not carry over from the Wi-Fi address.',
          'Retry',
          true
        );
        pushSessionWaitAttempts = 0;
        return;
      }
      pushSessionWaitAttempts = 0;
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setNotificationBanner('Phone push needs a browser with Web Push support. Live in-app updates still work.', '', false);
        return;
      }
      if (!window.isSecureContext) {
        setNotificationBanner('Phone push needs HTTPS or localhost. Live in-app updates still work while this page is open.', '', false);
        return;
      }
      if (Notification.permission === 'denied') {
        setNotificationBanner('Notifications are blocked in this browser. Enable them in site settings.', '', false);
        return;
      }
      // navigator.serviceWorker.ready NEVER rejects — it waits forever for an active worker. If
      // registration failed or a stale worker is wedged (common after a PWA install), this await
      // hangs and setupPushNotifications returns nothing at all: no banner, no error, no prompt.
      // A bounded wait turns that silence into something the user can act on.
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise(resolve => setTimeout(() => resolve(null), 10000))
      ]);
      if (!reg) {
        setNotificationBanner(
          'Notifications could not start: the service worker never became ready. Close and reopen the app, or reload this page.',
          'Retry',
          true
        );
        return;
      }
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        if (options.forceRefresh === true) {
          await existing.unsubscribe().catch(() => false);
          await subscribePush(reg, { refreshed: true });
          return;
        }
      // Already subscribed — send to server in case device was re-paired
        const res = await companionFetch('/api/push-subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription: existing })
      });
        if (res.status === 409) {
          const response = await res.json().catch(() => ({}));
          if (response.code === 'PUSH_SUBSCRIPTION_REFRESH_REQUIRED') {
            await existing.unsubscribe().catch(() => false);
            await subscribePush(reg, { refreshed: true });
            return;
          }
        }
        if (!res.ok) throw new Error('Subscription sync failed');
        hideNotificationBanner();
        return;
      }
    // Show banner prompting user to enable
      if (Notification.permission !== 'granted') {
        setNotificationBanner('Get notified when tasks finish', 'Enable', true);
        return;
      }
      if (Notification.permission === 'granted') {
      // Permission already granted but no subscription — subscribe silently
        await subscribePush(reg);
      }
    } catch (e) {
      console.warn('Push setup failed:', e);
      setNotificationBanner('Notification setup failed. Try refreshing after pairing.', 'Retry', true);
    } finally {
      pushRefreshInFlight = false;
    }
  }

  async function subscribePush(reg, options = {}) {
    try {
      // companionFetch, NOT fetch: /api/vapid-public-key sits behind the companion auth gate, so
      // a bare fetch() gets 401 COMPANION_CREDENTIAL_MISSING, publicKey comes back undefined, and
      // this bails with "notification keys are missing" — on every device, every origin, forever.
      // This was the real reason existing pairings never produced a push subscription.
      const keyRes = await companionFetch('/api/vapid-public-key');
      const keyPayload = await keyRes.json().catch(() => ({}));
      const publicKey = keyPayload && keyPayload.publicKey;
      if (!publicKey) {
        const detail = keyRes.status === 401
          ? 'the companion rejected this device — re-pair it here'
          : ((keyPayload && keyPayload.error) || ('server returned ' + keyRes.status));
        setNotificationBanner('Phone push is unavailable: ' + detail + '.', 'Retry', true);
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      const saveRes = await companionFetch('/api/push-subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription: sub, refreshed: options.refreshed === true })
      });
      if (!saveRes.ok) throw new Error('Subscription save failed');
      hideNotificationBanner();
    } catch (e) {
      console.warn('Push subscribe failed:', e);
      setNotificationBanner('Notification setup failed. Try again from this browser.', 'Retry', true);
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  if (notifEnableBtn) {
    notifEnableBtn.addEventListener('click', async () => {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setNotificationBanner('Phone push needs a browser with Web Push support. Live in-app updates still work.', '', false);
        return;
      }
      if (!window.isSecureContext) {
        setNotificationBanner('Phone push needs HTTPS or localhost. Live in-app updates still work while this page is open.', '', false);
        return;
      }
      // Without a device session the subscription cannot be saved (companionFetch has nothing to
      // authenticate with), so granting permission here would prompt and then silently fail.
      // Re-run setup instead: it reports the real blocker, which is that this address is unpaired.
      if (!deviceSession || !deviceSession.secret || !deviceSession.deviceId) {
        pushSessionWaitAttempts = 0;
        setupPushNotifications();
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        const reg = await navigator.serviceWorker.ready;
        await subscribePush(reg);
      } else {
        setNotificationBanner('Notifications were not enabled in this browser.', 'Retry', true);
      }
    });
  }

  // ── Boot ──────────────────────────────────────────
  if ('serviceWorker' in navigator) serviceWorkerRefresh
    .finally(() => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  if (deviceSession) startEventStream();
  else loadState({ force: true });
  // Give the stream a brief head start, but judge success by a state payload rather than by the
  // transport handshake. A connected stream whose snapshot is delayed gets one bounded HTTP
  // fallback instead of leaving the phone on Connecting indefinitely.
  setTimeout(() => {
    if (!sseStateReceived && !stateFetchController) loadState({ force: true });
  }, 1200);
  const statePollInterval = setInterval(loadState, 3000);
  const emergencyMessageInterval = setInterval(emergencyFillMessages, 1200);
  // Check local source updates once after auth settles, then every 5 minutes.
  setTimeout(checkForUpdate, 4000);
  setInterval(checkForUpdate, 5 * 60 * 1000);
  // Set up push notifications after auth settles
  setTimeout(setupPushNotifications, 5000);

  // When the page comes back into focus after being backgrounded (switching apps, locking screen),
  // Android Chrome throttles or kills background timers and drops the SSE fetch stream. Kick
  // both back to life immediately on visibility restore so the badge goes from Offline → Ready
  // without waiting for a throttled timer to fire.
  let foregroundRecoveryTimer = null;
  let foregroundRecoveryGeneration = 0;
  let lastForegroundRecoveryAt = 0;
  const FOREGROUND_RECOVERY_DEDUPE_MS = 1500;
  function recoverForegroundConnection() {
    if (document.hidden) return;
    const now = Date.now();
    if (sseActive && now - lastForegroundRecoveryAt < FOREGROUND_RECOVERY_DEDUPE_MS) return;
    if (foregroundRecoveryTimer) clearTimeout(foregroundRecoveryTimer);
    foregroundRecoveryTimer = setTimeout(() => {
      foregroundRecoveryTimer = null;
      lastForegroundRecoveryAt = Date.now();
      const recoveryGeneration = ++foregroundRecoveryGeneration;
      // Never trust a stream that crossed a mobile suspension boundary. Android can leave its
      // fetch reader pending and sseActive true long after the underlying socket is unusable.
      if (deviceSession) startEventStream({ force: true });
      else loadState({ force: true });
      const recoveryStartedAt = Date.now();
      setTimeout(() => {
        if (recoveryGeneration !== foregroundRecoveryGeneration || document.hidden) return;
        if (lastStatePayloadAt < recoveryStartedAt && !stateFetchController) loadState({ force: true });
      }, 1200);
      setTimeout(() => {
        if (recoveryGeneration !== foregroundRecoveryGeneration || document.hidden) return;
        if (lastStatePayloadAt === 0 && lastStatePayloadAt < recoveryStartedAt) {
          showReconnectBanner(sseConnected ? 'Connected · syncing latest state…' : 'Reconnecting to Orion…');
        }
      }, 650);
    }, 50);
  }

  function suspendBackgroundConnection() {
    foregroundRecoveryGeneration += 1;
    if (foregroundRecoveryTimer) clearTimeout(foregroundRecoveryTimer);
    foregroundRecoveryTimer = null;
    if (stateFetchController) stateFetchController.abort();
    stopEventStream();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspendBackgroundConnection();
    else recoverForegroundConnection();
  });
  window.addEventListener('pageshow', recoverForegroundConnection);
  window.addEventListener('online', recoverForegroundConnection);
  window.addEventListener('focus', recoverForegroundConnection);
  window.addEventListener('pagehide', suspendBackgroundConnection);

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn && navigator.vibrate) navigator.vibrate(50);
    });

  </script>

</body>
</html>`;
}

module.exports = companionHtml;
