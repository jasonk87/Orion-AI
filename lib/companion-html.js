'use strict';

function companionHtml(pairingCode) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Orion</title>
  <meta name="theme-color" content="#07070a">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&family=Outfit:wght@100..900&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg: #07070a;
      --surface: #111117;
      --surface2: #17171f;
      --line: rgba(255,255,255,0.07);
      --text: #e2e8f0;
      --muted: #6b7280;
      --accent: #60a5fa;
      --accent-strong: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      height: 100%;
      overflow: hidden;
      background: var(--bg);
      color: var(--text);
    }

    /* ── App Shell: full-height flex column ─────────── */
    .app-shell {
      height: 100%;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--bg);
    }

    /* ── Compact sticky header ───────────────────────── */
    .app-header {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: calc(10px + env(safe-area-inset-top)) 16px 10px;
      border-bottom: 1px solid var(--line);
      background: rgba(7,7,10,0.92);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      z-index: 10;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .mark {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      display: grid;
      place-items: center;
      background: linear-gradient(145deg, #60a5fa, #2563eb 60%, #111827);
      box-shadow: 0 6px 18px rgba(37,99,235,0.3);
      font-weight: 900;
      font-size: 0.85rem;
      color: #fff;
      flex: 0 0 auto;
    }
    .brand-name {
      font-size: 1rem;
      font-weight: 800;
      color: var(--text);
      letter-spacing: -0.01em;
    }
    .status-pill {
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(17,17,23,0.8);
      color: var(--muted);
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      transition: color 0.2s, border-color 0.2s, background 0.2s;
    }
    .status-pill.running {
      color: #6ee7b7;
      border-color: rgba(16,185,129,0.35);
      background: rgba(16,185,129,0.1);
    }
    .install-tip {
      display: none;
      margin-top: 8px;
      padding: 7px 10px;
      border: 1px dashed rgba(96,165,250,0.3);
      border-radius: 10px;
      color: #bfdbfe;
      background: rgba(37,99,235,0.08);
      font-size: 0.72rem;
      line-height: 1.4;
    }
    .install-tip.visible { display: block; }

    /* ── Tab panels container ────────────────────────── */
    .tab-panels {
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: hidden;
    }
    .tab-panel {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
    }
    .tab-panel.active {
      opacity: 1;
      pointer-events: all;
    }

    /* ── CHAT TAB ────────────────────────────────────── */
    #panel-chat {
      overflow: hidden;
    }

    .messages {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 12px 8px;
      scroll-behavior: smooth;
    }
    .messages::-webkit-scrollbar { width: 3px; }
    .messages::-webkit-scrollbar-track { background: transparent; }
    .messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

    .message {
      max-width: 84%;
      padding: 10px 13px;
      border-radius: 16px;
      font-size: 0.86rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .message.user {
      align-self: flex-end;
      background: linear-gradient(135deg, rgba(37,99,235,0.22), rgba(96,165,250,0.14));
      border: 1px solid rgba(96,165,250,0.25);
      color: var(--text);
    }
    .message.assistant {
      align-self: flex-start;
      background: var(--surface);
      border: 1px solid rgba(16,185,129,0.12);
      color: var(--text);
    }
    .message.system {
      align-self: center;
      max-width: 96%;
      background: transparent;
      color: var(--muted);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      text-align: center;
      padding: 4px 8px;
      border: none;
    }
    .role { display: none; }

    /* Markdown in messages */
    .message code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.82em;
      background: rgba(96,165,250,0.12);
      border: 1px solid rgba(96,165,250,0.16);
      border-radius: 4px;
      padding: 1px 5px;
    }
    .message pre {
      background: rgba(0,0,0,0.4);
      border: 1px solid var(--line);
      border-radius: 9px;
      padding: 10px 12px;
      overflow-x: auto;
      margin: 6px 0;
    }
    .message pre code {
      background: none;
      border: none;
      padding: 0;
      font-size: 0.8rem;
      color: #6ee7b7;
    }
    .message strong { font-weight: 700; }
    .message em { font-style: italic; color: #a5b4fc; }

    /* Typing indicator */
    .typing-indicator {
      display: none;
      align-items: center;
      padding: 4px 14px 10px;
      flex: 0 0 auto;
    }
    .typing-indicator.visible { display: flex; }
    .typing-bubble {
      display: flex;
      align-items: center;
      gap: 5px;
      background: var(--surface);
      border: 1px solid rgba(16,185,129,0.12);
      border-radius: 14px;
      padding: 9px 13px;
    }
    .typing-bubble .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--success);
      animation: typing-bounce 1.3s infinite ease-in-out;
    }
    .typing-bubble .dot:nth-child(2) { animation-delay: 0.18s; }
    .typing-bubble .dot:nth-child(3) { animation-delay: 0.36s; }
    @keyframes typing-bounce {
      0%, 80%, 100% { transform: scale(0.55); opacity: 0.35; }
      40% { transform: scale(1); opacity: 1; }
    }

    .empty {
      color: var(--muted);
      text-align: center;
      padding: 40px 16px;
      font-size: 0.8rem;
    }

    /* Composer area */
    .composer-area {
      flex: 0 0 auto;
      border-top: 1px solid var(--line);
      background: rgba(7,7,10,0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    /* Quick action chips */
    .quick-chips {
      display: flex;
      gap: 7px;
      padding: 9px 12px 5px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .quick-chips::-webkit-scrollbar { display: none; }
    .chip {
      flex: 0 0 auto;
      padding: 5px 11px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--text);
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      font-family: inherit;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
    }
    .chip:active { transform: scale(0.96); opacity: 0.8; }
    .chip:hover { border-color: rgba(96,165,250,0.3); background: rgba(96,165,250,0.06); }

    /* Form mode bar */
    .form-mode-bar {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 6px 14px 0;
      font-size: 0.76rem;
      font-weight: 650;
    }
    .form-mode-bar.visible { display: flex; }
    .form-mode-bar .mode-icon { font-size: 0.82rem; }
    .form-mode-bar .mode-label { color: var(--warning); }
    .form-mode-bar.revise-mode .mode-label { color: var(--accent); }
    .form-mode-bar .mode-cancel {
      margin-left: auto;
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 0.72rem;
      cursor: pointer;
      font-family: inherit;
    }

    /* Composer form */
    #prompt-form {
      padding: 8px 12px calc(10px + env(safe-area-inset-bottom));
    }
    .composer {
      display: flex;
      gap: 9px;
      align-items: flex-end;
    }
    textarea {
      width: 100%;
      min-height: 44px;
      max-height: 110px;
      resize: none;
      border: 1px solid rgba(96,165,250,0.2);
      border-radius: 14px;
      padding: 11px 13px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 0.9rem;
      line-height: 1.35;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    textarea::placeholder { color: var(--muted); }
    textarea:focus {
      border-color: rgba(96,165,250,0.45);
      box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
    }
    button.send-button {
      flex: 0 0 auto;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 12px;
      background: linear-gradient(145deg, #60a5fa, #2563eb);
      color: #fff;
      font-size: 1.2rem;
      font-weight: 900;
      cursor: pointer;
      font-family: inherit;
      display: grid;
      place-items: center;
      box-shadow: 0 8px 20px rgba(37,99,235,0.3);
      transition: opacity 0.15s, transform 0.1s;
    }
    button.send-button:active { transform: scale(0.95); }
    button.send-button:disabled { opacity: 0.5; cursor: wait; }
    button:active { transform: scale(0.97); }
    button:disabled { opacity: 0.5; cursor: wait; }

    /* ── STATUS TAB ──────────────────────────────────── */
    #panel-status {
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 14px 14px calc(14px + env(safe-area-inset-bottom));
      gap: 12px;
      display: flex;
      flex-direction: column;
    }
    #panel-status::-webkit-scrollbar { width: 3px; }
    #panel-status::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

    .indicator-banner {
      padding: 9px 13px;
      border-radius: 10px;
      font-size: 0.78rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 1px solid transparent;
      font-weight: 500;
      flex: 0 0 auto;
    }
    .indicator-banner.active-running {
      background: rgba(16,185,129,0.08);
      border-color: rgba(16,185,129,0.2);
      color: #34d399;
    }
    .indicator-banner.background-running {
      background: rgba(245,158,11,0.08);
      border-color: rgba(245,158,11,0.22);
      color: #fbbf24;
    }
    .indicator-banner.background-running button {
      background: #fbbf24;
      color: #0c0c0e;
      font-weight: 700;
      border: 0;
      padding: 4px 9px;
      border-radius: 6px;
      font-size: 0.72rem;
      cursor: pointer;
      font-family: inherit;
    }
    .indicator-banner.idle {
      background: rgba(255,255,255,0.02);
      border-color: rgba(255,255,255,0.05);
      color: var(--muted);
    }

    .status-card {
      padding: 13px 14px;
      border-radius: 13px;
      border: 1px solid var(--line);
      background: var(--surface);
    }
    .status-card.active-card {
      border-left: 3px solid var(--accent);
      background: linear-gradient(180deg, rgba(37,99,235,0.06), var(--surface));
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 7px;
    }
    .card-title {
      font-size: 0.92rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 4px;
    }
    .substatus-text { font-size: 0.74rem; color: var(--muted); }

    .info-card { display: flex; flex-direction: column; gap: 7px; }
    .info-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.78rem;
    }
    .info-label { color: var(--muted); }
    .info-value { color: var(--text); font-weight: 600; text-align: right; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .section-title {
      font-size: 0.7rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
      flex: 1;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 0.62rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .badge.success { background: rgba(16,185,129,0.12); color: #34d399; border: 1px solid rgba(16,185,129,0.22); }
    .badge.warning { background: rgba(245,158,11,0.12); color: #fbbf24; border: 1px solid rgba(245,158,11,0.22); }
    .badge.danger  { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.22); }
    .badge.muted   { background: rgba(255,255,255,0.04); color: var(--muted); border: 1px solid rgba(255,255,255,0.06); }
    .badge.active-view { background: rgba(37,99,235,0.12); color: #93c5fd; border: 1px solid rgba(96,165,250,0.22); }
    .badge.pulse { animation: status-pulse 1.8s infinite; }
    @keyframes status-pulse {
      0%, 100% { opacity: 0.55; }
      50% { opacity: 1; }
    }

    /* Controls */
    .ctx-controls-running, .ctx-controls-idle { display: none; }
    .ctx-controls-running.visible, .ctx-controls-idle.visible { display: block; }
    .control-row { display: flex; gap: 8px; }
    .ctrl-btn {
      flex: 1;
      min-height: 40px;
      border-radius: 10px;
      background: var(--surface);
      border: 1px solid var(--line);
      color: var(--text);
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, border-color 0.15s;
    }
    .ctrl-btn:hover { border-color: rgba(96,165,250,0.3); background: rgba(96,165,250,0.06); }

    /* Plan panel */
    .plan-panel {
      display: none;
      padding: 14px;
      border-radius: 13px;
      border: 1px solid rgba(245,158,11,0.28);
      background: rgba(245,158,11,0.05);
    }
    .plan-panel.visible { display: block; }
    .plan-title { font-size: 0.86rem; font-weight: 800; color: #fbbf24; margin-bottom: 4px; }
    .plan-copy { font-size: 0.76rem; color: var(--muted); line-height: 1.4; margin-bottom: 10px; }
    .approve-button {
      width: 100%;
      min-height: 42px;
      border-radius: 10px;
      border: 0;
      background: var(--warning);
      color: #0c0c0e;
      font-weight: 800;
      font-size: 0.88rem;
      cursor: pointer;
      font-family: inherit;
      margin-bottom: 8px;
      box-shadow: 0 8px 20px rgba(245,158,11,0.18);
    }
    .approve-button.approved {
      background: linear-gradient(145deg, #34d399, #059669);
      color: #fff;
      cursor: default;
    }

    /* Mission context */
    .mission-mobile-card { display: none; }
    .mission-mobile-card.visible { display: block; animation: card-enter 0.2s ease both; }
    @keyframes card-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .mission-mobile-title { font-size: 0.92rem; font-weight: 700; color: var(--text); margin: 6px 0; }
    .mission-mobile-objective { font-size: 0.76rem; color: var(--muted); margin-bottom: 8px; }
    .mission-mobile-condition { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; color: var(--muted); font-size: 0.76rem; }
    .mission-mobile-dot { width: 7px; height: 7px; flex: 0 0 auto; margin-top: 4px; border-radius: 50%; background: var(--muted); }
    .mission-mobile-condition.in_progress .mission-mobile-dot { background: var(--warning); }
    .mission-mobile-condition.satisfied .mission-mobile-dot { background: var(--success); }
    .mission-mobile-blocker { margin-top: 6px; padding: 6px 9px; border-left: 2px solid var(--danger); border-radius: 4px; background: rgba(239,68,68,0.06); color: #fca5a5; font-size: 0.74rem; }

    /* Queued prompts */
    .queued-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
    .queued-item { font-size: 0.74rem; color: var(--text); background: rgba(255,255,255,0.02); padding: 7px; border-radius: 7px; border: 1px solid var(--line); }

    /* Attention card */
    .attention-card {
      border: 1px solid rgba(245,158,11,0.22);
      background: rgba(245,158,11,0.04);
    }

    /* Recent tasks list */
    .recent-tasks-list { display: flex; flex-direction: column; gap: 2px; }
    .task-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .task-row:hover { background: rgba(255,255,255,0.03); border-color: var(--line); }
    .task-row.active-row { background: rgba(96,165,250,0.06); border-color: rgba(96,165,250,0.2); }
    .task-row-title { font-size: 0.84rem; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .task-row-meta { font-size: 0.7rem; color: var(--muted); margin-top: 2px; }

    /* ── LOGS TAB ────────────────────────────────────── */
    #panel-logs {
      overflow: hidden;
    }

    .logs-sub-tabs {
      flex: 0 0 auto;
      display: flex;
      gap: 4px;
      padding: 10px 12px 8px;
      border-bottom: 1px solid var(--line);
      background: var(--bg);
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .logs-sub-tabs::-webkit-scrollbar { display: none; }
    .log-tab-btn {
      flex: 0 0 auto;
      padding: 5px 12px;
      border-radius: 7px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .log-tab-btn.active {
      background: rgba(96,165,250,0.12);
      color: #93c5fd;
      border-color: rgba(96,165,250,0.24);
    }

    .logs-content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 12px;
    }
    .logs-content::-webkit-scrollbar { width: 3px; }
    .logs-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

    .tab-pane { display: none; font-size: 0.76rem; color: var(--muted); white-space: pre-wrap; word-break: break-all; line-height: 1.45; }
    .tab-pane.active { display: block; }
    .terminal-logs {
      font-family: 'JetBrains Mono', Consolas, monospace;
      background: #030408;
      color: #34d399;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--line);
      font-size: 0.69rem;
      line-height: 1.4;
      overflow: auto;
      margin-top: 8px;
    }
    .test-result-block {
      border-bottom: 1px solid var(--line);
      padding-bottom: 6px;
      margin-bottom: 6px;
      font-family: 'JetBrains Mono', monospace;
      white-space: pre-wrap;
    }
    .test-result-block:last-child { border-bottom: 0; }

    /* ── Bottom navigation ───────────────────────────── */
    .bottom-nav {
      flex: 0 0 auto;
      display: flex;
      border-top: 1px solid var(--line);
      background: rgba(7,7,10,0.96);
      padding-bottom: env(safe-area-inset-bottom);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    .nav-btn {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 9px 4px;
      border: 0;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-family: inherit;
      transition: color 0.15s;
      position: relative;
    }
    .nav-btn.active { color: var(--accent); }
    .nav-btn.active::after {
      content: '';
      position: absolute;
      top: 0;
      left: 30%;
      right: 30%;
      height: 2px;
      background: var(--accent);
      border-radius: 0 0 2px 2px;
    }
    .nav-icon { font-size: 1.2rem; line-height: 1; }
    .nav-label { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.02em; }

    /* ── New Task Bottom Sheet ───────────────────────── */
    .sheet-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:40; backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); }
    .sheet-overlay.open { display:block; }
    .new-task-sheet {
      position:fixed; bottom:0; left:0; right:0; z-index:41;
      background:var(--surface2); border-radius:20px 20px 0 0;
      border-top:1px solid var(--line);
      box-shadow:0 -24px 60px rgba(0,0,0,0.5);
      padding-bottom:calc(20px + env(safe-area-inset-bottom));
      transform:translateY(100%);
      transition:transform 0.3s cubic-bezier(0.2,0.8,0.2,1);
      max-height:86vh; overflow-y:auto;
    }
    .new-task-sheet.open { transform:translateY(0); }
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

    /* Utility: btn-sm used in status tab */
    .btn-sm {
      padding: 5px 10px;
      font-size: 0.74rem;
      border-radius: 7px;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--line);
      color: var(--text);
      cursor: pointer;
      font-family: inherit;
      font-weight: 600;
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
    }
    @media (min-width: 700px) {
      .app-shell { max-width: 760px; margin: 0 auto; border-left: 1px solid rgba(255,255,255,0.05); border-right: 1px solid rgba(255,255,255,0.05); }
    }
  </style>
</head>
<body>
<div class="app-shell">

  <!-- Compact single-line header -->
  <header class="app-header">
    <div class="brand">
      <div class="mark">O</div>
      <span class="brand-name">Orion</span>
    </div>
    <div class="status-pill" id="status-pill">Offline</div>
    <div class="install-tip" id="install-tip"></div>
  </header>

  <!-- Tab panels -->
  <div class="tab-panels">

    <!-- ── CHAT TAB (default) ──────────────────────── -->
    <div class="tab-panel active" id="panel-chat">
      <div class="messages" id="messages">
        <div class="empty">Loading conversation...</div>
      </div>
      <div class="typing-indicator" id="typing-indicator">
        <div class="typing-bubble">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
      <div class="composer-area">
        <div class="quick-chips">
          <button class="chip" id="chip-stop" type="button">⏹ Stop</button>
          <button class="chip" id="chip-new-task" type="button">🔄 New Task</button>
          <button class="chip" id="chip-copy-last" type="button">📋 Copy Last</button>
        </div>
        <div class="form-mode-bar" id="form-mode-bar">
          <span class="mode-icon">&#x25B6;</span>
          <span class="mode-label" id="form-mode-label">Steering</span>
          <button class="mode-cancel" id="form-mode-cancel" type="button">Cancel</button>
        </div>
        <form id="prompt-form">
          <div class="composer">
            <textarea id="prompt" placeholder="Ask Orion..." autocomplete="off" rows="1"></textarea>
            <button class="send-button" id="send" type="submit">&#x2191;</button>
          </div>
        </form>
      </div>
    </div>

    <!-- ── STATUS TAB ──────────────────────────────── -->
    <div class="tab-panel" id="panel-status">

      <!-- Global running indicator -->
      <div id="global-indicator-banner" class="indicator-banner idle">
        <span>Agent is currently idle</span>
      </div>

      <!-- Current task card -->
      <div class="section-header">
        <div class="section-title">Current Task</div>
        <span class="badge muted" id="project-count-badge">0 Projects</span>
        <button id="new-task" type="button" class="btn-sm">+ New</button>
      </div>
      <div id="active-task-container" class="status-card active-card">
        <div class="empty">Loading...</div>
      </div>

      <!-- Context info -->
      <div class="status-card info-card">
        <div class="info-row"><span class="info-label">Model</span><span class="info-value" id="model">—</span></div>
        <div class="info-row"><span class="info-label">Status</span><span class="info-value" id="status">—</span></div>
        <div class="info-row"><span class="info-label">Workspace</span><span class="info-value" id="meta">Connecting...</span></div>
      </div>

      <!-- Contextual controls -->
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

      <!-- Plan approval -->
      <section class="plan-panel" id="plan-panel">
        <div class="plan-title">Plan waiting for approval</div>
        <div class="plan-copy">Review the latest plan in chat. Start it here when the direction looks right.</div>
        <button class="approve-button" id="approve-plan" type="button">Start Implementation</button>
        <div class="control-row">
          <button id="deny-plan" type="button" class="ctrl-btn">Deny</button>
          <button id="revise-plan" type="button" class="ctrl-btn">Revise</button>
        </div>
      </section>

      <!-- Mission context -->
      <div id="mission-context-card" class="status-card mission-mobile-card">
        <div class="card-header">
          <div class="section-title">Mission Control</div>
          <span class="badge muted" id="mission-context-revision">Not set</span>
        </div>
        <div class="mission-mobile-title" id="mission-context-title"></div>
        <div class="mission-mobile-objective" id="mission-context-objective"></div>
        <div id="mission-context-conditions"></div>
        <div id="mission-context-blockers"></div>
      </div>

      <!-- Attention tasks -->
      <div id="attention-tasks-container"></div>

      <!-- Queued prompts -->
      <div id="queued-prompts-container" class="status-card" style="display:none;"></div>

      <!-- Recent tasks -->
      <div class="section-header" style="margin-top:4px;">
        <div class="section-title">Recent Tasks</div>
      </div>
      <div id="recent-tasks-list" class="recent-tasks-list">
        <div class="empty">Loading...</div>
      </div>

      <!-- Hidden compat elements -->
      <div style="display:none;">
        <select id="project-select"><option value="">Standalone conversation</option></select>
        <button id="new-task-dup"></button>
        <div id="queue-line"></div>
        <div id="latest-output"></div>
        <div id="preview-panel"></div>
        <div id="tasks"></div>
      </div>
    </div>

    <!-- ── LOGS TAB ─────────────────────────────────── -->
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
          <div id="launch-url-container" style="margin-bottom:8px; font-weight:600;">No app launch URL recorded.</div>
          <pre id="launch-logs-container" class="terminal-logs">No launch logs yet.</pre>
        </div>
      </div>
    </div>

  </div><!-- /tab-panels -->

  <!-- Bottom tab navigation -->
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

</div><!-- /app-shell -->

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

<script>
  const pairingCode = ${JSON.stringify(pairingCode)};
  const sessionKey = 'orionPhoneCompanionSession';
  let deviceSession = null;
  try { deviceSession = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch (e) { deviceSession = null; }

  // ── DOM refs ────────────────────────────────────────
  const messagesEl               = document.getElementById('messages');
  const metaEl                   = document.getElementById('meta');
  const modelEl                  = document.getElementById('model');
  const statusEl                 = document.getElementById('status');
  const statusPillEl             = document.getElementById('status-pill');
  const planPanelEl              = document.getElementById('plan-panel');
  const approvePlanEl            = document.getElementById('approve-plan');
  const denyPlanEl               = document.getElementById('deny-plan');
  const revisePlanEl             = document.getElementById('revise-plan');
  const refreshStateEl           = document.getElementById('refresh-state');
  const stopTaskEl               = document.getElementById('stop-task');
  const resumeTaskEl             = document.getElementById('resume-task');
  const newTaskEl                = document.getElementById('new-task');
  const steerTaskEl              = document.getElementById('steer-task');
  const projectSelectEl          = document.getElementById('project-select');
  const projectCountBadgeEl      = document.getElementById('project-count-badge');
  const globalIndicatorBanner    = document.getElementById('global-indicator-banner');
  const activeTaskContainer      = document.getElementById('active-task-container');
  const attentionTasksContainer  = document.getElementById('attention-tasks-container');
  const queuedPromptsContainer   = document.getElementById('queued-prompts-container');
  const recentTasksList          = document.getElementById('recent-tasks-list');
  const missionContextCard       = document.getElementById('mission-context-card');
  const missionContextRevision   = document.getElementById('mission-context-revision');
  const missionContextTitle      = document.getElementById('mission-context-title');
  const missionContextObjective  = document.getElementById('mission-context-objective');
  const missionContextConditions = document.getElementById('mission-context-conditions');
  const missionContextBlockers   = document.getElementById('mission-context-blockers');
  const installTipEl             = document.getElementById('install-tip');
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
  const typingIndicatorEl        = document.getElementById('typing-indicator');

  let lastSignature = '';
  let projectSelectInitialized = false;
  let lastProjectOptionsSignature = '';
  let currentConversationId = '';
  let formMode = 'prompt'; // 'prompt' | 'steer' | 'revise'
  let availableProjects = [];
  let selectedSheetProject = '';

  // ── Bottom tab navigation ──────────────────────────
  const navBtns   = document.querySelectorAll('.nav-btn');
  const panelEls  = document.querySelectorAll('.tab-panel');

  function switchTab(panelId) {
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.panel === panelId));
    panelEls.forEach(p => p.classList.toggle('active', p.id === panelId));
  }
  navBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.panel)));

  // ── Simple markdown renderer ───────────────────────
  function renderMarkdown(text) {
    if (!text) return '';
    let s = String(text);
    const blocks = [];
    s = s.replace(/\`\`\`([\w]*)\n?([\s\S]*?)\`\`\`/g, (_, lang, code) => {
      const idx = blocks.length;
      blocks.push('<pre><code>' + escapeHtml(code.replace(/^\n|\n$/g, '')) + '</code></pre>');
      return '\x00BLOCK' + idx + '\x00';
    });
    s = escapeHtml(s);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/\`([^\`]+?)\`/g, '<code>$1</code>');
    s = s.replace(/\n/g, '<br>');
    s = s.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => blocks[parseInt(i)]);
    return s;
  }

  // ── Form mode (steer / revise / prompt) ───────────
  function setFormMode(mode) {
    formMode = mode;
    if (mode === 'steer') {
      formModeBar.className = 'form-mode-bar visible';
      formModeLabel.textContent = 'Steering active work';
      promptEl.placeholder = 'How should Orion adjust its approach?';
      switchTab('panel-chat');
      promptEl.focus();
    } else if (mode === 'revise') {
      formModeBar.className = 'form-mode-bar revise-mode visible';
      formModeLabel.textContent = 'Revising plan';
      promptEl.placeholder = 'What should change in the plan?';
      switchTab('panel-chat');
      promptEl.focus();
    } else {
      formMode = 'prompt';
      formModeBar.className = 'form-mode-bar';
      promptEl.placeholder = 'Ask Orion...';
    }
  }
  formModeCancel.addEventListener('click', () => setFormMode('prompt'));

  // ── New Task Sheet ─────────────────────────────────
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
  newTaskEl.addEventListener('click', openSheet);
  sheetStart.addEventListener('click', async () => {
    sheetStart.disabled = true;
    const projectPath = selectedSheetProject;
    const initialPrompt = sheetPrompt.value.trim();
    try {
      const res = await companionFetch('/api/conversations/new', { method: 'POST', body: JSON.stringify({ prompt: '', projectPath }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'New task failed');
      currentConversationId = data.conversationId || currentConversationId;
      closeSheet();
      if (initialPrompt) {
        const pRes = await companionFetch('/api/prompt', { method: 'POST', body: JSON.stringify({ prompt: initialPrompt }) });
        const pData = await pRes.json();
        if (!pData.success) statusEl.textContent = pData.error || 'Send failed';
      }
      await loadState();
    } catch (err) {
      statusEl.textContent = err.message;
    } finally {
      sheetStart.disabled = false;
    }
  });

  // ── Quick action chips ─────────────────────────────
  document.getElementById('chip-stop').addEventListener('click', () => stopTaskEl.click());
  document.getElementById('chip-new-task').addEventListener('click', openSheet);
  document.getElementById('chip-copy-last').addEventListener('click', () => {
    const allMsgs = messagesEl.querySelectorAll('.message.assistant');
    if (allMsgs.length) {
      const txt = allMsgs[allMsgs.length - 1].innerText || allMsgs[allMsgs.length - 1].textContent;
      navigator.clipboard.writeText(txt).catch(() => {});
    }
  });

  function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }

  async function switchTask(taskId) {
    if (!taskId) return;
    statusEl.textContent = 'Switching console view...';
    try {
      const res = await companionFetch('/api/conversations/switch', { method:'POST', body: JSON.stringify({ conversationId: taskId }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Switch failed');
      await loadState();
    } catch (error) {
      statusEl.textContent = error.message;
    }
  }
  window.switchTask = switchTask;

  async function loadState() {
    try {
      if (!deviceSession) {
        statusEl.textContent = 'Pairing with Orion...';
        statusPillEl.textContent = 'Pairing';
        const pairResult = await pairIfNeeded();
        if (!pairResult.success) {
          statusPillEl.textContent = 'Pairing';
          if (!pairResult.pending) {
            statusEl.innerHTML = 'Pairing denied. <button class="btn-sm" onclick="location.reload()">Retry Pairing</button>';
            clearInterval(statePollInterval);
          }
          return;
        }
      }
      const res = await companionFetch('/api/state');
      if (res.status === 401) {
        localStorage.removeItem(sessionKey);
        deviceSession = null;
        statusEl.textContent = 'Session invalid or revoked. Re-pairing...';
        setTimeout(() => { location.reload(); }, 1500);
        return;
      }
      const state = await res.json();
      if (!state.success) throw new Error(state.error || 'Failed to load state');

      currentConversationId = state.conversationId || '';
      metaEl.textContent = state.title || 'No active conversation';
      modelEl.textContent = state.model || '-';
      const phoneSubStatus = state.subStatus || '';
      const phoneAgentState = state.awaitingPlanApproval
        ? 'Review'
        : (!state.running
          ? 'Ready'
          : (/run_tests|test|verif/i.test(phoneSubStatus)
            ? 'Verifying'
            : (/running tool/i.test(phoneSubStatus) || state.executionMode === 'executing' || state.executionMode === 'direct' ? 'Acting' : 'Thinking')));
      statusPillEl.textContent = phoneAgentState;
      statusPillEl.classList.toggle('running', !!state.running);
      statusEl.textContent = state.subStatus || state.workspace || '';

      planPanelEl.classList.toggle('visible', !!state.awaitingPlanApproval);

      // Typing indicator
      typingIndicatorEl.classList.toggle('visible', !!state.running);

      // 1. Global running indicator
      const viewingId = state.conversationId;
      const runningId = state.runningConversationId;
      const globalRunning = !!state.globalRunning;

      if (globalRunning) {
        if (viewingId === runningId) {
          globalIndicatorBanner.className = 'indicator-banner active-running';
          globalIndicatorBanner.innerHTML = '<span>Viewing globally running task</span>';
        } else {
          const runningTaskObj = (state.conversations || []).find(c => c.id === runningId);
          const runningTitle = runningTaskObj ? runningTaskObj.title : 'Another Task';
          globalIndicatorBanner.className = 'indicator-banner background-running';
          globalIndicatorBanner.innerHTML = '<span>Running: <strong>' + escapeHtml(runningTitle) + '</strong></span><button onclick="switchTask(\\\'' + escapeHtml(runningId) + '\\\')">Switch View</button>';
        }
      } else {
        globalIndicatorBanner.className = 'indicator-banner idle';
        globalIndicatorBanner.innerHTML = '<span>Agent is currently idle</span>';
      }

      // 2. Active task card
      const activeConv = (state.conversations || []).find(c => c.id === viewingId);
      if (activeConv) {
        const isRunning = globalRunning && runningId === viewingId;
        const statusText = isRunning ? 'Running' : (activeConv.awaitingPlanApproval ? 'Needs Attention' : 'Idle');
        const badgeClass = isRunning ? 'success' : (activeConv.awaitingPlanApproval ? 'warning' : 'muted');
        activeTaskContainer.innerHTML = \`
          <div class="card-header">
            <span style="font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:var(--accent);">Current Task View</span>
            <div style="display:flex;gap:5px;">
              <span class="badge \${badgeClass} \${isRunning ? 'pulse' : ''}">\${statusText}</span>
              <span class="badge active-view">Viewing</span>
            </div>
          </div>
          <div class="card-title">\${escapeHtml(activeConv.title)}</div>
          <div class="substatus-text">\${escapeHtml(state.subStatus || state.workspace || '')}</div>
        \`;
      } else {
        activeTaskContainer.innerHTML = '<div class="empty">No task selected</div>';
      }

      // Mission context
      const missionContext = state.operationalContext || {};
      const hasMissionContext = !!(missionContext.mission || (missionContext.winConditions || []).length);
      missionContextCard.classList.toggle('visible', hasMissionContext);
      if (hasMissionContext) {
        missionContextRevision.textContent = 'r' + (missionContext.revision || 0);
        missionContextTitle.textContent = missionContext.mission || 'Mission not defined';
        missionContextObjective.textContent = missionContext.activeSubplan
          ? 'Now: ' + missionContext.activeSubplan.title + ' (' + missionContext.activeSubplan.status + ')'
          : (missionContext.activeObjective ? 'Objective: ' + missionContext.activeObjective : 'No active objective');
        missionContextConditions.innerHTML = (missionContext.winConditions || []).map(condition =>
          '<div class="mission-mobile-condition ' + escapeHtml(condition.status) + '">' +
            '<span class="mission-mobile-dot"></span><span>' + escapeHtml(condition.title) + '</span>' +
          '</div>'
        ).join('');
        missionContextBlockers.innerHTML = (missionContext.blockers || []).map(blocker =>
          '<div class="mission-mobile-blocker">Blocked: ' + escapeHtml(blocker.title) + '</div>'
        ).join('');
      }

      // 3. Needs attention tasks
      const attentionTasks = (state.conversations || []).filter(c => c.awaitingPlanApproval);
      if (attentionTasks.length > 0) {
        attentionTasksContainer.innerHTML = attentionTasks.map(c => {
          const isViewing = c.id === viewingId;
          return '<div class="status-card attention-card" style="margin-bottom:8px;">' +
            '<div class="card-header">' +
              '<span class="badge warning">Plan Awaiting Approval</span>' +
              (isViewing ? '<span class="badge active-view">Viewing</span>' : '') +
            '</div>' +
            '<div class="card-title">' + escapeHtml(c.title) + '</div>' +
            '<div style="margin-top:8px;">' +
              (isViewing ? '' : '<button class="btn-sm" onclick="switchTask(\\\'' + escapeHtml(c.id) + '\\\')">Switch to Approve</button>') +
            '</div>' +
          '</div>';
        }).join('');
      } else {
        attentionTasksContainer.innerHTML = '';
      }

      // 4. Queued prompts
      if (state.queuedPrompts > 0) {
        queuedPromptsContainer.innerHTML = \`
          <div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:var(--accent);margin-bottom:7px;">Queued Prompts (\${state.queuedPrompts})</div>
          <div class="queued-list">
            \${(state.queuedPromptPreview || []).map(p => '<div class="queued-item">' + escapeHtml(p) + '</div>').join('')}
          </div>
        \`;
        queuedPromptsContainer.style.display = 'block';
      } else {
        queuedPromptsContainer.style.display = 'none';
      }

      // 5. Recent tasks list
      if (state.conversations && state.conversations.length > 0) {
        recentTasksList.innerHTML = state.conversations.map(c => {
          const isViewing = c.id === viewingId;
          const isRunning = globalRunning && c.id === runningId;
          const isAwaiting = !!c.awaitingPlanApproval;
          let badgesHtml = '';
          if (isViewing)  badgesHtml += '<span class="badge active-view">Viewing</span>';
          if (isRunning)  badgesHtml += '<span class="badge success pulse">Running</span>';
          if (isAwaiting) badgesHtml += '<span class="badge warning">Attention</span>';
          if (!isViewing && !isRunning && !isAwaiting) badgesHtml += '<span class="badge muted">Ready</span>';
          const timeText = new Date(c.updatedAt || 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return '<div class="task-row' + (isViewing ? ' active-row' : '') + '" onclick="switchTask(\\\'' + escapeHtml(c.id) + '\\\')">' +
            '<div style="flex:1;min-width:0;overflow:hidden;">' +
              '<div class="task-row-title">' + escapeHtml(c.title) + '</div>' +
              '<div class="task-row-meta">Updated: ' + timeText + ' &middot; ' + c.taskCount + ' items</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;padding-left:8px;">' + badgesHtml + '</div>' +
          '</div>';
        }).join('');
      } else {
        recentTasksList.innerHTML = '<div class="empty">No tasks in workspace.</div>';
      }

      // 6. Logs tab content
      document.getElementById('tab-output').textContent = (state.preview || {}).latestAssistantOutput || 'No assistant output yet.';

      const walkthroughPane = document.getElementById('tab-walkthrough');
      walkthroughPane.textContent = (state.preview || {}).workWalkthrough || 'No walkthrough yet.';

      const filesPane = document.getElementById('tab-files');
      const changedFiles = (state.preview || {}).changedFiles;
      if (Array.isArray(changedFiles) && changedFiles.length) {
        filesPane.innerHTML = changedFiles.map(f => '<div style="margin-bottom:4px;font-family:monospace;font-size:0.72rem;">' + escapeHtml(f) + '</div>').join('');
      } else {
        filesPane.textContent = 'No changed files recorded.';
      }

      const testsPane = document.getElementById('tab-tests');
      const testResults = (state.preview || {}).testResults;
      if (Array.isArray(testResults) && testResults.length) {
        testsPane.innerHTML = testResults.map(r => '<div class="test-result-block">' + escapeHtml(r) + '</div>').join('');
      } else {
        testsPane.textContent = 'No test results recorded.';
      }

      const launchUrlContainer = document.getElementById('launch-url-container');
      if ((state.preview || {}).appLaunchUrl) {
        launchUrlContainer.innerHTML = '<strong>Launch URL:</strong> <a href="' + escapeHtml(state.preview.appLaunchUrl) + '" target="_blank" style="color:var(--accent);text-decoration:underline;">' + escapeHtml(state.preview.appLaunchUrl) + '</a>';
      } else {
        launchUrlContainer.textContent = 'No app launch URL recorded.';
      }
      document.getElementById('launch-logs-container').textContent = (state.preview || {}).appLaunchLogs || 'No launch logs yet.';

      // Projects
      const projects = Array.isArray(state.projects) ? state.projects : [];
      availableProjects = projects;
      projectCountBadgeEl.textContent = projects.length + (projects.length === 1 ? ' Project' : ' Projects');
      const projectOptionsSignature = JSON.stringify(projects.map(p => p.path));
      if (projectOptionsSignature !== lastProjectOptionsSignature) {
        projectSelectEl.innerHTML = '<option value="">Standalone conversation</option>' + projects.map(p => '<option value="' + escapeHtml(p.path) + '">' + escapeHtml(p.name) + '</option>').join('');
        lastProjectOptionsSignature = projectOptionsSignature;
      }

      // Contextual controls
      ctxRunning.classList.toggle('visible', !!state.running);
      ctxIdle.classList.toggle('visible', !state.running);

      // 7. Messages feed
      const signature = JSON.stringify({ running: state.running, subStatus: state.subStatus, plan: state.awaitingPlanApproval, conversations: state.conversations, projects: state.projects, messages: state.messages });
      if (signature !== lastSignature) {
        lastSignature = signature;
        messagesEl.innerHTML = !state.messages || state.messages.length === 0
          ? '<div class="empty">No messages yet.</div>'
          : state.messages.map(msg =>
              '<div class="message ' + escapeHtml(msg.role) + '"><span class="role">' + escapeHtml(msg.role) + '</span>' +
              (msg.role === 'system' ? escapeHtml(msg.text) : renderMarkdown(msg.text)) + '</div>'
            ).join('');
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    } catch (error) {
      statusEl.textContent = error.message;
      statusPillEl.textContent = 'Offline';
      statusPillEl.classList.remove('running');
    }
  }

  approvePlanEl.addEventListener('click', async () => {
    const originalLabel = approvePlanEl.textContent;
    approvePlanEl.disabled = true;
    approvePlanEl.textContent = 'Starting…';
    statusEl.textContent = 'Starting approved plan...';
    try {
      const res = await companionFetch('/api/approve-plan', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Approval failed');
      approvePlanEl.classList.add('approved');
      approvePlanEl.textContent = '✓ Implementation Started';
      await loadState();
    } catch (error) {
      statusEl.textContent = error.message;
      approvePlanEl.disabled = false;
      approvePlanEl.textContent = originalLabel;
    }
  });
  denyPlanEl.addEventListener('click', async () => {
    const res = await companionFetch('/api/deny-plan', { method: 'POST' });
    const data = await res.json();
    if (!data.success) statusEl.textContent = data.error || 'Deny failed';
    await loadState();
  });
  revisePlanEl.addEventListener('click', () => setFormMode('revise'));
  refreshStateEl.addEventListener('click', loadState);
  steerTaskEl.addEventListener('click', () => setFormMode('steer'));
  stopTaskEl.addEventListener('click', async () => {
    stopTaskEl.disabled = true;
    statusEl.textContent = 'Stopping active work...';
    try {
      const res = await companionFetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Stop failed');
      await loadState();
    } catch (error) {
      statusEl.textContent = error.message;
    } finally {
      stopTaskEl.disabled = false;
    }
  });
  resumeTaskEl.addEventListener('click', async () => {
    resumeTaskEl.disabled = true;
    statusEl.textContent = 'Resuming work...';
    try {
      const res = await companionFetch('/api/resume', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Resume failed');
      await loadState();
    } catch (error) {
      statusEl.textContent = error.message;
    } finally {
      resumeTaskEl.disabled = false;
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = promptEl.value.trim();
    if (!text) return;
    document.getElementById('send').disabled = true;
    statusEl.textContent = 'Sending...';
    try {
      if (formMode === 'steer') {
        const res = await companionFetch('/api/steer', { method: 'POST', body: JSON.stringify({ prompt: text }) });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Steer failed');
        setFormMode('prompt');
      } else if (formMode === 'revise') {
        const res = await companionFetch('/api/revise-plan', { method: 'POST', body: JSON.stringify({ feedback: text }) });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Revision failed');
        setFormMode('prompt');
      } else {
        if (!currentConversationId) {
          const newTaskRes = await companionFetch('/api/conversations/new', { method: 'POST', body: JSON.stringify({ prompt: '', projectPath: '' }) });
          const newTask = await newTaskRes.json();
          if (!newTask.success) throw new Error(newTask.error || 'New task failed');
          currentConversationId = newTask.conversationId || currentConversationId;
        }
        const res = await companionFetch('/api/prompt', { method: 'POST', body: JSON.stringify({ prompt: text }) });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Send failed');
      }
      promptEl.value = '';
      await loadState();
    } catch (error) {
      statusEl.textContent = error.message;
    } finally {
      document.getElementById('send').disabled = false;
    }
  });
  promptEl.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });
  // Auto-resize textarea
  promptEl.addEventListener('input', () => {
    promptEl.style.height = 'auto';
    promptEl.style.height = Math.min(promptEl.scrollHeight, 110) + 'px';
  });

  // ── Logs sub-tab clicks ────────────────────────────
  document.querySelectorAll('.log-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.log-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');
    });
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installTipEl.classList.add('visible');
    installTipEl.textContent = 'This companion is installable. Open your browser menu and choose Install app or Add to Home Screen.';
  });

  async function companionFetch(url, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (deviceSession) {
      headers.Authorization = 'Bearer ' + deviceSession.secret;
      headers['X-Orion-Device-Id'] = deviceSession.deviceId;
    }
    return fetch(url, Object.assign({}, options, { headers }));
  }

  let isPairing = false;
  async function pairIfNeeded() {
    if (deviceSession) return { success: true };
    if (isPairing) return { success: false, pending: true };
    isPairing = true;
    const code = new URLSearchParams(location.search).get('pair') || pairingCode;
    const name = (navigator.userAgent || 'Phone').slice(0, 64);
    try {
      const res = await fetch('/api/pair', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ pairingCode: code, deviceName: name }) });
      const data = await res.json();
      if (!data.success) {
        statusEl.textContent = data.error || 'Pairing pending or denied';
        return { success: false, pending: data.pending !== false };
      }
      deviceSession = { deviceId: data.device.id, secret: data.sessionSecret };
      localStorage.setItem(sessionKey, JSON.stringify(deviceSession));
      statusEl.textContent = 'Connected';
      return { success: true };
    } catch (err) {
      statusEl.textContent = 'Connection error: ' + err.message;
      return { success: false, pending: true };
    } finally {
      isPairing = false;
    }
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  loadState();
  const statePollInterval = setInterval(loadState, 3000);
</script>
</body>
</html>`;
}

module.exports = companionHtml;
