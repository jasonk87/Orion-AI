'use strict';

function companionHtml(pairingCode) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Orion</title>
  <meta name="theme-color" content="#f7f7f5">
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
      --panel: rgba(20, 20, 31, 0.6);
      --panel-strong: rgba(28, 28, 43, 0.85);
      --line: rgba(96, 165, 250, 0.16);
      --text: #f3f1fe;
      --muted: #9f9aa7;
      --accent: #60a5fa;
      --accent-strong: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at 18% -10%, rgba(37,99,235,.22), transparent 34%), radial-gradient(circle at 86% 0%, rgba(14,165,233,.13), transparent 34%), linear-gradient(180deg,#090b12 0%,#07070a 45%,#050508 100%);
      overflow-x: hidden;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image: linear-gradient(rgba(255,255,255,.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.015) 1px, transparent 1px);
      background-size: 32px 32px;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,.8), transparent 65%);
    }
    .app-shell { min-height: 100vh; padding-bottom: calc(164px + env(safe-area-inset-bottom)); }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      padding: calc(14px + env(safe-area-inset-top)) 16px 12px;
      border-bottom: 1px solid var(--line);
      background: rgba(7,7,10,.82);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }
    .topline { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .brand { display: flex; align-items: center; min-width: 0; gap: 10px; }
    .mark {
      width: 36px;
      height: 36px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      background: linear-gradient(145deg, #60a5fa, #2563eb 58%, #111827);
      box-shadow: 0 10px 30px rgba(37,99,235,.26);
      font-weight: 900;
      color: #fff;
    }
    h1 { margin: 0; font-size: 1.05rem; letter-spacing: 0; line-height: 1.1; font-weight: 700; }
    .meta { margin-top: 4px; color: var(--muted); font-size: .76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 68vw; }
    .status-pill {
      flex: 0 0 auto;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(20,20,31,.6);
      color: var(--muted);
      font-size: .72rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .status-pill.running {
      color: #e8ddff;
      border-color: rgba(16,185,129,.35);
      background: rgba(16,185,129,.12);
    }

    /* Indicator Banner */
    .indicator-banner {
      padding: 10px 14px;
      border-radius: 10px;
      margin-top: 12px;
      font-size: 0.78rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 1px solid transparent;
      font-weight: 500;
    }
    .indicator-banner.active-running {
      background: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.2);
      color: #34d399;
    }
    .indicator-banner.background-running {
      background: rgba(245, 158, 11, 0.08);
      border-color: rgba(245, 158, 11, 0.2);
      color: #fbbf24;
    }
    .indicator-banner.background-running button {
      background: #fbbf24;
      color: #0c0c0e;
      font-weight: 700;
      border: 0;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      cursor: pointer;
      font-family: inherit;
    }
    .indicator-banner.idle {
      background: rgba(255, 255, 255, 0.02);
      border-color: rgba(255, 255, 255, 0.05);
      color: var(--muted);
    }

    .context-card {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid rgba(255,255,255,.05);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(24,23,36,.5), rgba(13,13,20,.4));
    }
    .context-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font-size: .75rem; }
    .model { color: var(--text); font-weight: 700; }
    .substatus { margin-top: 8px; color: var(--accent); font-size: .76rem; min-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .install-tip { display: none; margin-top: 10px; padding: 9px 10px; border: 1px dashed rgba(96,165,250,.36); border-radius: 12px; color: #bfdbfe; background: rgba(37,99,235,.1); font-size: .76rem; line-height: 1.35; }
    .install-tip.visible { display: block; }

    main { position: relative; z-index: 1; padding: 14px; display: flex; flex-direction: column; gap: 16px; }

    /* Plan Panel */
    .plan-panel {
      display: none;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid rgba(245, 158, 11, 0.3);
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(167, 139, 250, 0.04));
      margin-bottom: 4px;
    }
    .plan-panel.visible { display: block; }
    .plan-title { font-size: .86rem; font-weight: 800; margin-bottom: 4px; color: #fbbf24; }
    .plan-copy { color: var(--muted); font-size: .78rem; line-height: 1.35; margin-bottom: 10px; }

    /* Dashboard and Cards */
    .dashboard-panel { display: flex; flex-direction: column; gap: 12px; }
    .panel-header-row { display: flex; align-items: center; justify-content: space-between; }
    .sub-panel-title { font-size: .74rem; color: #93c5fd; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; }

    .btn-sm-primary {
      min-height: 32px;
      padding: 0 12px;
      font-size: 0.78rem;
      border-radius: 8px;
      font-weight: 700;
      background: var(--accent-strong);
      color: #fff;
      border: 0;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.22);
      cursor: pointer;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      transition: transform .16s ease, border-color .16s ease, background .16s ease, opacity .16s ease;
    }
    .btn-sm {
      min-height: 28px;
      padding: 0 10px;
      font-size: 0.75rem;
      border-radius: 6px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: var(--text);
      cursor: pointer;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      transition: transform .16s ease, border-color .16s ease, background .16s ease, opacity .16s ease;
    }

    .dashboard-card {
      padding: 14px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: var(--panel);
    }
    .dashboard-card.active-card {
      border-left: 4px solid var(--accent);
      background: linear-gradient(180deg, rgba(37, 99, 235, 0.05), rgba(20, 20, 31, 0.6));
    }
    .dashboard-cards-grid { display: flex; flex-direction: column; gap: 8px; }
    .attention-card {
      border: 1px solid rgba(245, 158, 11, 0.25);
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.05), rgba(20, 20, 31, 0.6));
    }
    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .card-title { font-size: 0.94rem; font-weight: 700; color: var(--text); margin-bottom: 6px; }
    .substatus-text { font-size: 0.74rem; color: var(--muted); min-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .badge { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 4px; font-size: 0.64rem; font-weight: 700; text-transform: uppercase; }
    .badge.success { background: rgba(16, 185, 129, 0.1); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.2); }
    .badge.warning { background: rgba(245, 158, 11, 0.1); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.2); }
    .badge.danger { background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2); }
    .badge.muted { background: rgba(255, 255, 255, 0.04); color: var(--muted); border: 1px solid rgba(255, 255, 255, 0.06); }
    .badge.active-view { background: rgba(37, 99, 235, 0.12); color: #93c5fd; border: 1px solid rgba(96, 165, 250, 0.22); }
    .badge.pulse { animation: status-pulse 1.8s infinite; }
    @keyframes status-pulse {
      0% { opacity: 0.6; }
      50% { opacity: 1; }
      100% { opacity: 0.6; }
    }

    .queued-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
    .queued-item { font-size: 0.72rem; color: #d1d5db; background: rgba(255,255,255,0.02); padding: 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); }

    .recent-tasks-list { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto; padding-right: 4px; }
    .task-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.05); background: rgba(255,255,255,0.01); cursor: pointer; transition: all 0.2s ease; }
    .task-row:hover { border-color: rgba(167, 139, 250, 0.18); background: rgba(167, 139, 250, 0.02); }
    .task-row.active-row { border-color: rgba(167, 139, 250, 0.3); background: rgba(167, 139, 250, 0.05); }
    .task-row-title { font-size: 0.82rem; font-weight: 600; color: var(--text); }
    .task-row-meta { font-size: 0.7rem; color: var(--muted); margin-top: 2px; }

    /* Upgraded Activity Panel with Tabs */
    .activity-panel {
      padding: 14px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: var(--panel);
    }
    .tab-header { display: flex; gap: 4px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px; margin-bottom: 10px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .tab-btn {
      flex: 1;
      min-height: 30px;
      padding: 0 10px;
      font-size: 0.72rem;
      border-radius: 6px;
      background: transparent;
      border: 0;
      color: var(--muted);
      cursor: pointer;
      font-weight: 600;
      text-align: center;
      white-space: nowrap;
      box-shadow: none;
      font-family: inherit;
    }
    .tab-btn.active {
      background: rgba(37, 99, 235, 0.15);
      color: #93c5fd;
      border: 1px solid rgba(96, 165, 250, 0.22);
    }
    .tab-content { position: relative; }
    .tab-pane { display: none; font-size: 0.74rem; color: var(--muted); white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow-y: auto; line-height: 1.4; }
    .tab-pane.active { display: block; }
    .terminal-logs { font-family: 'JetBrains Mono', Consolas, monospace; background: #040406; color: #34d399; padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); margin: 0; font-size: 0.68rem; line-height: 1.35; max-height: 140px; overflow: auto; }
    .test-result-block { border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 6px; margin-bottom: 6px; }
    .test-result-block:last-child { border-bottom: 0; }

    /* Action Grouping */
    .action-grouping { display: flex; flex-direction: column; gap: 8px; margin-bottom: 4px; }
    .control-row { display: flex; gap: 8px; }
    .control-row button { flex: 1; min-width: 0; min-height: 38px; border-radius: 12px; background: rgba(20,20,31,.6); border: 1px solid var(--line); color: var(--text); box-shadow: none; font-size: 0.8rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; text-align: center; white-space: nowrap; transition: transform .16s ease, border-color .16s ease, background .16s ease, opacity .16s ease; }
    .control-row button:hover { border-color: rgba(167, 139, 250, 0.35); background: rgba(167, 139, 250, 0.04); }
    .approve-button { width: 100%; background: #f59e0b; color: #0c0c0e; font-weight: 850; box-shadow: 0 12px 26px rgba(245,158,11,.18); cursor: pointer; }
    .project-select-panel { display: flex; flex-direction: column; gap: 8px; }
    select {
      width: 100%;
      min-height: 38px;
      border-radius: 10px;
      border: 1px solid rgba(96,165,250,.22);
      background: rgba(20,20,31,.9);
      color: var(--text);
      padding: 0 10px;
      font: inherit;
      font-size: .78rem;
      outline: none;
    }

    .messages { display: flex; flex-direction: column; gap: 12px; max-height: 320px; overflow-y: auto; padding-right: 4px; }
    .message { max-width: 92%; padding: 12px 13px; border: 1px solid rgba(255,255,255,.05); border-radius: 17px; line-height: 1.48; white-space: pre-wrap; word-break: break-word; background: rgba(20,20,31,.4); box-shadow: 0 12px 30px rgba(0,0,0,.12); font-size: 0.8rem; }
    .message.user { align-self: flex-end; border-color: rgba(96,165,250,.28); background: linear-gradient(135deg, rgba(37,99,235,.16), rgba(24,32,54,.84)); }
    .message.assistant { align-self: flex-start; border-color: rgba(52,211,153,.15); }
    .message.system { align-self: center; max-width: 100%; color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: .74rem; background: rgba(12,12,18,.5); }
    .role { display: block; margin-bottom: 6px; color: #93c5fd; font-size: .64rem; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; }

    form { position: fixed; z-index: 8; left: 0; right: 0; bottom: 0; padding: 12px 12px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid rgba(255,255,255,.06); background: rgba(7,7,10,.9); backdrop-filter: blur(22px); -webkit-backdrop-filter: blur(22px); }
    .composer { display: flex; gap: 10px; align-items: flex-end; }
    textarea { width: 100%; min-height: 54px; max-height: 132px; resize: none; border: 1px solid rgba(96,165,250,.22); border-radius: 15px; padding: 12px 13px; background: rgba(20,20,31,.9); color: var(--text); font: inherit; line-height: 1.35; outline: none; }
    textarea:focus { border-color: rgba(96,165,250,.52); box-shadow: 0 0 0 3px rgba(37,99,235,.1); }
    button.send-button { border: 0; border-radius: 14px; background: var(--accent-strong); color: #fff; font-weight: 850; font-size: .9rem; min-height: 48px; padding: 0 15px; box-shadow: 0 12px 26px rgba(37,99,235,.28); cursor: pointer; font-family: inherit; }
    .send-button { flex: 0 0 auto; min-width: 72px; }
    button:active { transform: translateY(1px); }
    button:disabled { opacity: .55; cursor: wait; }

    .empty { color: var(--muted); text-align: center; padding: 36px 12px; font-size: 0.76rem; }
    /* Codex-inspired mobile shell, Orion palette */
    :root {
      color-scheme: light;
      --bg: #f7f7f5;
      --panel: rgba(255,255,255,.82);
      --panel-strong: #ffffff;
      --line: rgba(24,24,27,.09);
      --text: #18181b;
      --muted: #6f6f76;
      --accent: #7c3aed;
      --accent-strong: #5b2a86;
      --success: #16a34a;
      --warning: #b45309;
      --danger: #dc2626;
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    body {
      background:
        radial-gradient(circle at 50% -16%, rgba(124,58,237,.12), transparent 34%),
        linear-gradient(180deg, #fbfbfa 0%, #f7f7f5 60%, #f1f0ee 100%);
    }
    body::before { display: none; }
    .app-shell {
      min-height: 100vh;
      padding-bottom: calc(94px + env(safe-area-inset-bottom));
      background: transparent;
    }
    header {
      border-bottom: 0;
      background: linear-gradient(180deg, rgba(247,247,245,.98), rgba(247,247,245,.78));
      padding: calc(14px + env(safe-area-inset-top)) 18px 10px;
    }
    .topline {
      display: grid;
      grid-template-columns: 44px 1fr 44px;
      align-items: center;
      min-height: 48px;
    }
    .brand {
      justify-self: center;
      justify-content: center;
      gap: 0;
      text-align: center;
    }
    .brand::before,
    .status-pill::after {
      width: 44px;
      height: 44px;
      border-radius: 22px;
      display: grid;
      place-items: center;
      background: rgba(255,255,255,.76);
      box-shadow: 0 10px 28px rgba(24,24,27,.08);
      color: var(--text);
      font-size: 1.35rem;
      line-height: 1;
    }
    .brand::before {
      content: "\\2039";
      position: absolute;
      left: 18px;
      font-size: 2rem;
      padding-bottom: 4px;
    }
    .status-pill::after {
      content: "\\22ee";
      position: absolute;
      right: 18px;
      top: calc(14px + env(safe-area-inset-top));
      font-weight: 800;
    }
    .mark { display: none; }
    h1 {
      font-size: 1.03rem;
      font-weight: 800;
      color: var(--text);
    }
    .brand h1 { font-size: 0; }
    .brand h1::after { content: "Orion"; font-size: 1.08rem; }
    .meta {
      max-width: 72vw;
      margin-top: 4px;
      color: var(--muted);
      font-size: .72rem;
    }
    .status-pill {
      width: 0;
      height: 0;
      padding: 0;
      border: 0;
      overflow: hidden;
      background: transparent;
      color: transparent;
    }
    .context-card {
      margin-top: 12px;
      padding: 0;
      border: 0;
      background: transparent;
    }
    .context-row {
      justify-content: center;
      font-size: .8rem;
      gap: 8px;
    }
    .context-row span:first-child { display: none; }
    .model {
      color: var(--muted);
      font-weight: 700;
    }
    .substatus {
      text-align: center;
      color: var(--muted);
      font-size: .74rem;
      margin-top: 3px;
    }
    .indicator-banner {
      margin-top: 12px;
      padding: 0;
      border: 0;
      background: transparent !important;
      color: var(--text) !important;
      justify-content: center;
      font-size: .78rem;
      gap: 8px;
    }
    .indicator-banner::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #c9c9cf;
    }
    .indicator-banner.active-running::before { background: var(--success); }
    .indicator-banner.background-running::before { background: #f59e0b; }
    .indicator-banner button {
      border: 0;
      border-radius: 999px;
      background: #ece8f4 !important;
      color: var(--accent-strong) !important;
      padding: 5px 9px;
      font: inherit;
      font-size: .72rem;
      font-weight: 800;
    }
    main {
      padding: 18px 20px 22px;
      gap: 28px;
    }
    .dashboard-panel,
    .recent-tasks-section,
    .chat-section,
    .activity-panel {
      gap: 14px;
    }
    .dashboard-panel {
      display: grid;
      grid-template-areas:
        "top"
        "projects"
        "active"
        "plan"
        "actions"
        "attention"
        "queued"
        "recents";
    }
    .dashboard-panel > .panel-header-row { grid-area: top; }
    .project-select-panel { grid-area: projects; }
    #active-task-container { grid-area: active; }
    #plan-panel { grid-area: plan; }
    .action-grouping { grid-area: actions; }
    #attention-tasks-container { grid-area: attention; }
    #queued-prompts-container { grid-area: queued; }
    .recent-tasks-section { grid-area: recents; }
    .panel-header-row {
      align-items: center;
      gap: 12px;
    }
    .sub-panel-title {
      color: var(--text);
      font-size: .92rem;
      text-transform: none;
      letter-spacing: 0;
      font-weight: 850;
    }
    .dashboard-panel > .panel-header-row .sub-panel-title::before { content: "Projects"; }
    .dashboard-panel > .panel-header-row .sub-panel-title { font-size: 0; }
    .dashboard-panel > .panel-header-row .sub-panel-title::before { font-size: 1rem; }
    .btn-sm-primary {
      min-height: 48px;
      padding: 0 18px;
      border-radius: 999px;
      background: #151518;
      box-shadow: 0 12px 30px rgba(24,24,27,.16);
      font-size: .9rem;
    }
    .btn-sm-primary::before { content: "\\270e "; }
    .dashboard-card,
    .activity-panel,
    .plan-panel {
      border: 0;
      background: transparent;
      box-shadow: none;
      padding: 0;
      border-radius: 0;
    }
    .project-select-panel {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .project-select-panel .panel-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    select {
      min-height: 50px;
      border-radius: 15px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.9);
      color: var(--text);
      font-size: .95rem;
      box-shadow: 0 8px 24px rgba(24,24,27,.05);
    }
    .badge {
      border-radius: 999px;
      border: 0 !important;
      background: #eeeeef !important;
      color: var(--muted) !important;
      text-transform: none;
      font-size: .72rem;
      padding: 4px 8px;
    }
    .badge.success { background: rgba(22,163,74,.12) !important; color: #15803d !important; }
    .badge.warning { background: rgba(245,158,11,.15) !important; color: #92400e !important; }
    .badge.active-view { background: rgba(124,58,237,.13) !important; color: var(--accent-strong) !important; }
    .dashboard-card.active-card {
      background: #ffffff;
      border: 1px solid var(--line);
      border-left: 0;
      border-radius: 18px;
      padding: 14px;
      box-shadow: 0 12px 30px rgba(24,24,27,.06);
    }
    .card-title {
      font-size: 1rem;
      font-weight: 750;
    }
    .substatus-text,
    .task-row-meta {
      color: var(--muted);
      font-size: .76rem;
    }
    .control-row {
      gap: 10px;
    }
    .control-row button,
    .btn-sm {
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255,255,255,.78);
      color: var(--text);
      box-shadow: 0 8px 20px rgba(24,24,27,.04);
      font-size: .82rem;
      font-weight: 750;
    }
    .plan-panel {
      padding: 14px;
      border-radius: 18px;
      background: #fff7ed;
      border: 1px solid rgba(245,158,11,.22);
    }
    .plan-title { color: #92400e; }
    .approve-button {
      min-height: 44px;
      border: 0;
      border-radius: 999px;
      background: #151518;
      color: #fff;
    }
    .approve-button.approved {
      background: linear-gradient(145deg, #2fb37e, #1f9d6a);
      color: #fff;
      cursor: default;
      box-shadow: 0 10px 24px rgba(47,179,126,.22);
    }
    .recent-tasks-section .sub-panel-title::before { content: "Recents"; }
    .recent-tasks-section .sub-panel-title { font-size: 0; }
    .recent-tasks-section .sub-panel-title::before { font-size: 1rem; }
    .recent-tasks-list {
      max-height: none;
      gap: 0;
      overflow: visible;
    }
    .task-row {
      border: 0;
      border-radius: 0;
      background: transparent;
      padding: 13px 0;
      border-bottom: 1px solid rgba(24,24,27,.06);
    }
    .task-row.active-row {
      background: transparent;
      border-color: rgba(24,24,27,.08);
    }
    .task-row-title {
      color: var(--text);
      font-size: .96rem;
      font-weight: 500;
    }
    .task-row-right .badge:not(.success):not(.warning) { display: none; }
    .activity-panel {
      display: none;
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
      box-shadow: 0 12px 30px rgba(24,24,27,.05);
    }
    .activity-panel:has(.tab-pane.active:not(:empty)) { display: block; }
    .tab-header {
      border: 0;
      gap: 6px;
      margin-bottom: 10px;
    }
    .tab-btn {
      border-radius: 999px;
      background: #f0f0f1;
      color: var(--muted);
    }
    .tab-btn.active {
      background: #151518;
      color: #fff;
      border: 0;
    }
    .tab-pane {
      color: var(--muted);
      word-break: break-word;
    }
    .terminal-logs {
      background: #f6f6f7;
      color: #166534;
      border: 1px solid var(--line);
    }
    .messages {
      max-height: none;
      gap: 16px;
      overflow: visible;
    }
    .chat-section .sub-panel-title::before { content: "Chat"; }
    .chat-section .sub-panel-title { font-size: 0; }
    .chat-section .sub-panel-title::before { font-size: 1rem; }
    .message {
      border: 0;
      box-shadow: none;
      max-width: 100%;
      background: transparent;
      color: var(--text);
      padding: 0;
      font-size: .98rem;
      line-height: 1.48;
    }
    .message.user {
      max-width: 78%;
      align-self: flex-end;
      background: #ececec;
      border-radius: 22px;
      padding: 14px 16px;
    }
    .message.assistant { align-self: stretch; }
    .message.system {
      align-self: stretch;
      font-family: inherit;
      color: var(--muted);
      background: transparent;
      font-size: .82rem;
    }
    .role { display: none; }
    .queued-item {
      background: #ffffff;
      border: 1px solid var(--line);
      color: var(--text);
      border-radius: 12px;
    }
    .install-tip.visible {
      background: #fff;
      color: var(--muted);
      border: 1px solid var(--line);
    }
    form {
      border-top: 0;
      background: linear-gradient(180deg, rgba(247,247,245,0), rgba(247,247,245,.96) 24%, rgba(247,247,245,.98));
      padding: 12px 20px calc(12px + env(safe-area-inset-bottom));
    }
    .composer {
      align-items: center;
      gap: 10px;
    }
    .composer::before {
      content: "+";
      flex: 0 0 46px;
      height: 46px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      background: #fff;
      color: #151518;
      font-size: 1.8rem;
      line-height: 1;
      box-shadow: 0 10px 24px rgba(24,24,27,.08);
    }
    textarea {
      min-height: 48px;
      max-height: 110px;
      border: 1px solid rgba(24,24,27,.06);
      border-radius: 999px;
      background: #ffffff;
      color: var(--text);
      padding: 12px 48px 12px 18px;
      box-shadow: 0 10px 24px rgba(24,24,27,.08);
      font-size: .95rem;
    }
    textarea:focus {
      border-color: rgba(124,58,237,.22);
      box-shadow: 0 0 0 4px rgba(124,58,237,.08), 0 10px 24px rgba(24,24,27,.08);
    }
    button.send-button {
      min-width: 46px;
      width: 46px;
      min-height: 46px;
      padding: 0;
      border-radius: 999px;
      background: var(--accent-strong);
      font-size: 0;
      box-shadow: 0 12px 26px rgba(91,42,134,.22);
    }
    button.send-button::before {
      content: "\\203a";
      font-size: 2rem;
      line-height: 1;
      transform: rotate(-90deg);
      display: inline-block;
      margin-top: 2px;
    }
    .empty {
      color: var(--muted);
      font-size: .86rem;
    }
    .mission-mobile-card { display: none; }
    .mission-mobile-card.visible { display: block; }
    .mission-mobile-title { font-size: .96rem; font-weight: 760; line-height: 1.35; margin: 7px 0; }
    .mission-mobile-objective { color: var(--muted); font-size: .78rem; margin-bottom: 10px; }
    .mission-mobile-condition { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; color: var(--muted); font-size: .78rem; }
    .mission-mobile-dot { width: 8px; height: 8px; flex: 0 0 auto; margin-top: 3px; border-radius: 50%; background: #a1a1aa; }
    .mission-mobile-condition.in_progress .mission-mobile-dot { background: #d97706; }
    .mission-mobile-condition.satisfied .mission-mobile-dot { background: #059669; }
    .mission-mobile-blocker { margin-top: 7px; padding: 7px 9px; border-left: 2px solid #dc2626; border-radius: 4px; background: rgba(220,38,38,.06); color: #991b1b; font-size: .75rem; }
    /* Unified Orion dark companion theme */
    :root {
      color-scheme: dark;
      --bg: #090b12;
      --panel: #111724;
      --panel-strong: #151c2a;
      --line: rgba(151,164,196,.15);
      --text: #f4f6fb;
      --muted: #8994a9;
      --accent: #8273f4;
      --accent-strong: #6f5bea;
      --success: #46d59b;
      --warning: #f2b84b;
      --danger: #f16876;
      font-family: "Segoe UI Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    body {
      background: radial-gradient(circle at 50% -12%, rgba(96,78,210,.16), transparent 30%), var(--bg);
      color: var(--text);
    }
    .app-shell { background: transparent; }
    header {
      border-bottom: 1px solid var(--line);
      background: rgba(9,11,18,.9);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }
    .brand::before,
    .status-pill::after { display: none; }
    .status-pill {
      position: absolute;
      top: calc(18px + env(safe-area-inset-top));
      right: 18px;
      width: auto;
      height: auto;
      overflow: visible;
      padding: 5px 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(21,28,42,.9);
      color: var(--muted);
      font-size: .66rem;
      font-weight: 750;
    }
    .status-pill.running { border-color: rgba(130,115,244,.28); color: #c9c2ff; }
    .brand::before,
    .status-pill::after {
      background: rgba(21,28,42,.88);
      color: var(--text);
      border: 1px solid var(--line);
      box-shadow: 0 10px 28px rgba(0,0,0,.24);
    }
    h1, .sub-panel-title, .card-title { color: var(--text); }
    .model, .meta, .substatus, .substatus-text, .task-row-meta { color: var(--muted); }
    .indicator-banner { color: var(--text) !important; }
    .indicator-banner::before { background: #596378; }
    .indicator-banner button { background: rgba(130,115,244,.13) !important; color: #c9c2ff !important; }
    main { gap: 24px; }
    .dashboard-panel {
      grid-template-areas:
        "top"
        "projects"
        "active"
        "mission"
        "plan"
        "actions"
        "attention"
        "queued"
        "recents";
    }
    #mission-context-card { grid-area: mission; }
    .dashboard-card.active-card,
    .mission-mobile-card.visible,
    .activity-panel,
    .plan-panel {
      border: 1px solid var(--line);
      border-radius: 16px;
      background: linear-gradient(145deg, rgba(21,28,42,.96), rgba(14,19,30,.96));
      box-shadow: 0 16px 38px rgba(0,0,0,.2), inset 0 1px rgba(255,255,255,.02);
      padding: 14px;
    }
    .mission-mobile-card.visible { animation: mobile-card-enter .24s cubic-bezier(.2,.8,.2,1) both; }
    .mission-mobile-title { color: var(--text); }
    .mission-mobile-objective, .mission-mobile-condition { color: var(--muted); }
    .mission-mobile-condition.in_progress .mission-mobile-dot { background: var(--warning); box-shadow: 0 0 9px rgba(242,184,75,.28); }
    .mission-mobile-condition.satisfied .mission-mobile-dot { background: var(--success); box-shadow: 0 0 9px rgba(70,213,155,.24); }
    .mission-mobile-blocker { background: rgba(241,104,118,.08); color: #ffb5bd; border-color: var(--danger); }
    select,
    textarea {
      border-color: var(--line);
      background: rgba(17,23,36,.96);
      color: var(--text);
      box-shadow: inset 0 1px rgba(255,255,255,.018), 0 10px 26px rgba(0,0,0,.13);
    }
    textarea::placeholder { color: #657086; }
    select:focus,
    textarea:focus { border-color: rgba(130,115,244,.62); box-shadow: 0 0 0 3px rgba(130,115,244,.1); }
    .btn-sm-primary,
    button.send-button {
      background: linear-gradient(145deg, #8f80ff, #6654e7);
      color: white;
      box-shadow: 0 12px 28px rgba(85,67,216,.28);
    }
    .control-row button,
    .btn-sm {
      border-color: var(--line);
      background: rgba(17,23,36,.86);
      color: var(--text);
      box-shadow: none;
    }
    .control-row button:active,
    .btn-sm:active,
    .send-button:active { transform: scale(.98); }
    .badge { background: rgba(137,148,169,.12) !important; color: var(--muted) !important; }
    .badge.success { background: rgba(70,213,155,.12) !important; color: #7aebbb !important; }
    .badge.warning { background: rgba(242,184,75,.13) !important; color: #f7ce7d !important; }
    .badge.active-view { background: rgba(130,115,244,.15) !important; color: #c9c2ff !important; }
    .task-row { border-color: rgba(151,164,196,.1); }
    .task-row:hover, .task-row.active-row { background: rgba(130,115,244,.055); }
    .task-row-title { color: var(--text); }
    .activity-panel { display: block; }
    .tab-btn { background: rgba(137,148,169,.1); color: var(--muted); }
    .tab-btn.active { background: rgba(130,115,244,.18); color: #d8d3ff; border: 1px solid rgba(130,115,244,.28); }
    .tab-pane { color: var(--muted); }
    .terminal-logs { background: #080b11; color: #78e7b7; border-color: var(--line); }
    .message { color: var(--text); }
    .message.user { background: rgba(130,115,244,.16); border: 1px solid rgba(130,115,244,.22); }
    .message.system { color: var(--muted); }
    .queued-item { background: var(--panel); border-color: var(--line); color: var(--text); }
    .install-tip.visible { background: var(--panel); color: var(--muted); border-color: var(--line); }
    form {
      border-top: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(9,11,18,0), rgba(9,11,18,.96) 24%, rgba(9,11,18,.99));
    }
    .composer::before { background: var(--panel-strong); color: var(--text); border: 1px solid var(--line); box-shadow: 0 10px 24px rgba(0,0,0,.22); }
    button.send-button::before { content: "\\2191"; font-size: 1.25rem; transform: none; margin: 0; }
    .empty { color: var(--muted); }
    @keyframes mobile-card-enter {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
    }
    @media (min-width:700px) {
      .app-shell { max-width: 760px; margin: 0 auto; border-left: 1px solid rgba(255,255,255,.05); border-right: 1px solid rgba(255,255,255,.05); }
      form { left: 50%; transform: translateX(-50%); max-width: 760px; }
      .meta { max-width: 520px; }
    }
    /* ── NEW TASK BOTTOM SHEET ──────────────────── */
    .sheet-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.52); z-index:40; backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); }
    .sheet-overlay.open { display:block; }
    .new-task-sheet {
      position:fixed; bottom:0; left:0; right:0; z-index:41;
      background:var(--panel-strong); border-radius:24px 24px 0 0;
      border-top:1px solid var(--line);
      box-shadow:0 -24px 60px rgba(0,0,0,.48);
      padding-bottom:calc(24px + env(safe-area-inset-bottom));
      transform:translateY(100%);
      transition:transform .32s cubic-bezier(.2,.8,.2,1);
      max-height:86vh; overflow-y:auto;
    }
    .new-task-sheet.open { transform:translateY(0); }
    .sheet-handle { width:36px; height:4px; background:rgba(255,255,255,.18); border-radius:2px; margin:10px auto 18px; }
    .sheet-header { padding:0 20px 14px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--line); }
    .sheet-title { font-size:1rem; font-weight:700; color:var(--text); }
    .sheet-close-btn { width:30px; height:30px; border-radius:50%; background:rgba(255,255,255,.07); border:1px solid var(--line); color:var(--muted); font-size:1.1rem; cursor:pointer; display:grid; place-items:center; line-height:1; }
    .sheet-section { padding:14px 20px 0; }
    .sheet-label { font-size:.68rem; font-weight:700; letter-spacing:.08em; color:var(--muted); text-transform:uppercase; margin-bottom:9px; }
    .proj-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .proj-tile {
      padding:11px 13px; border-radius:14px;
      border:1px solid var(--line); background:rgba(17,23,36,.7);
      cursor:pointer; transition:border-color .15s,background .15s,transform .12s;
      text-align:left;
    }
    .proj-tile:active { transform:scale(.97); }
    .proj-tile.selected { border-color:rgba(130,115,244,.55); background:rgba(130,115,244,.12); box-shadow:0 0 0 2px rgba(130,115,244,.12); }
    .proj-tile.standalone { grid-column:1/-1; border-color:rgba(70,213,155,.22); background:rgba(70,213,155,.05); }
    .proj-tile.standalone.selected { border-color:rgba(70,213,155,.55); background:rgba(70,213,155,.1); }
    .proj-tile-name { font-size:.86rem; font-weight:650; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .proj-tile.standalone .proj-tile-name { color:var(--success); }
    .proj-tile-meta { font-size:.71rem; color:var(--muted); margin-top:3px; }
    .sheet-textarea { width:100%; min-height:78px; background:rgba(9,11,18,.7); border:1px solid var(--line); border-radius:14px; color:var(--text); font-size:.95rem; font-family:inherit; padding:12px 14px; resize:none; outline:none; box-sizing:border-box; margin-top:12px; }
    .sheet-textarea:focus { border-color:rgba(130,115,244,.62); box-shadow:0 0 0 3px rgba(130,115,244,.09); }
    .sheet-textarea::placeholder { color:#657086; }
    .sheet-start-btn { margin-top:10px; width:100%; min-height:48px; border-radius:14px; background:linear-gradient(145deg,#8f80ff,#6654e7); color:white; font-size:.95rem; font-weight:700; border:0; cursor:pointer; box-shadow:0 12px 28px rgba(85,67,216,.28); transition:opacity .15s,transform .12s; }
    .sheet-start-btn:active { transform:scale(.98); opacity:.9; }
    .sheet-start-btn:disabled { opacity:.45; cursor:not-allowed; }
    /* ── FORM MODE BAR (steer / revise) ─────────── */
    .form-mode-bar { display:none; align-items:center; gap:8px; padding:8px 20px 0; font-size:.78rem; font-weight:650; }
    .form-mode-bar.visible { display:flex; }
    .form-mode-bar .mode-icon { font-size:.85rem; }
    .form-mode-bar .mode-label { color:var(--warning); }
    .form-mode-bar.revise-mode .mode-label { color:var(--accent); }
    .form-mode-bar .mode-cancel { margin-left:auto; padding:3px 10px; border-radius:999px; background:rgba(255,255,255,.06); border:1px solid var(--line); color:var(--muted); font-size:.73rem; cursor:pointer; }
    /* ── TOP ROW ─────────────────────────────────── */
    .workspace-header-row { display:flex; align-items:center; gap:8px; padding-bottom:4px; }
    .workspace-header-row .sub-panel-title { flex:1; }
    .btn-new-task { padding:6px 14px; border-radius:999px; background:rgba(130,115,244,.15); border:1px solid rgba(130,115,244,.28); color:#c9c2ff; font-size:.8rem; font-weight:700; cursor:pointer; white-space:nowrap; transition:background .15s; }
    .btn-new-task:active { background:rgba(130,115,244,.26); }
    /* ── CONTEXTUAL CONTROLS ─────────────────────── */
    .ctx-controls-running, .ctx-controls-idle { display:none; }
    .ctx-controls-running.visible, .ctx-controls-idle.visible { display:block; }
    /* ── MESSAGE MARKDOWN ────────────────────────── */
    .message code { font-family:'JetBrains Mono',monospace; font-size:.82em; background:rgba(130,115,244,.14); border:1px solid rgba(130,115,244,.18); border-radius:5px; padding:1px 5px; }
    .message pre { background:rgba(9,11,18,.8); border:1px solid var(--line); border-radius:10px; padding:12px 14px; overflow-x:auto; margin:8px 0; }
    .message pre code { background:none; border:none; padding:0; font-size:.82rem; color:#78e7b7; }
    .message strong { color:var(--text); font-weight:700; }
    .message em { font-style:italic; color:var(--muted); }
  </style>
</head>
<body>
  <div class="app-shell">
    <header>
      <div class="topline">
        <div class="brand"><div class="mark">O</div><div><h1>Orion</h1><div class="meta" id="meta">Connecting...</div></div></div>
        <div class="status-pill" id="status-pill">Offline</div>
      </div>
      <div id="global-indicator-banner" class="indicator-banner idle">
        <span>Agent is currently idle</span>
      </div>
      <div class="context-card">
        <div class="context-row"><span>Model</span><span class="model" id="model">-</span></div>
        <div class="substatus" id="status"></div>
        <div class="install-tip" id="install-tip">Install this companion from your browser menu with Add to Home Screen. Full PWA install support may require HTTPS on some phones.</div>
      </div>
    </header>
    <main>
      <!-- Mobile task console -->
      <section class="dashboard-panel">
        <div class="workspace-header-row">
          <div class="sub-panel-title">Tasks</div>
          <span class="badge muted" id="project-count-badge">0 Projects</span>
          <button id="new-task" type="button" class="btn-new-task">+ New Task</button>
        </div>
        <select id="project-select" style="display:none;"><option value="">Standalone conversation</option></select>

        <div id="active-task-container" class="dashboard-card active-card">
          <div class="empty">Loading tasks...</div>
        </div>

        <div id="mission-context-card" class="dashboard-card mission-mobile-card">
          <div class="panel-header-row">
            <div class="sub-panel-title">Mission Control</div>
            <span class="badge muted" id="mission-context-revision">Not set</span>
          </div>
          <div class="mission-mobile-title" id="mission-context-title"></div>
          <div class="mission-mobile-objective" id="mission-context-objective"></div>
          <div id="mission-context-conditions"></div>
          <div id="mission-context-blockers"></div>
        </div>

        <section class="plan-panel" id="plan-panel">
          <div class="plan-title">Plan waiting for approval</div>
          <div class="plan-copy">Review the latest plan in chat. Start it here when the direction looks right.</div>
          <button class="approve-button" id="approve-plan" type="button">Start Implementation</button>
          <div class="control-row" style="margin-top: 8px;">
            <button id="deny-plan" type="button">Deny</button>
            <button id="revise-plan" type="button">Revise</button>
          </div>
        </section>

        <div class="action-grouping">
          <div class="ctx-controls-running" id="ctx-controls-running">
            <div class="control-row">
              <button id="steer-task" type="button">Steer</button>
              <button id="stop-task" type="button">Pause</button>
            </div>
          </div>
          <div class="ctx-controls-idle" id="ctx-controls-idle">
            <div class="control-row">
              <button id="resume-task" type="button">Resume</button>
              <button id="refresh-state" type="button">Refresh</button>
            </div>
          </div>
        </div>

        <div id="attention-tasks-container" class="dashboard-cards-grid"></div>
        <div id="queued-prompts-container" class="dashboard-card" style="display: none;"></div>

        <div class="recent-tasks-section">
          <div class="sub-panel-title">Recents</div>
          <div id="recent-tasks-list" class="recent-tasks-list">
            <div class="empty">Loading...</div>
          </div>
        </div>
      </section>

      <!-- Upgraded Activity Panel -->
      <section class="activity-panel">
        <div class="sub-panel-title" style="margin-bottom: 8px;">Activity</div>
        <div class="tab-header">
          <button class="tab-btn active" data-tab="tab-output">Output</button>
          <button class="tab-btn" data-tab="tab-walkthrough">Walkthrough</button>
          <button class="tab-btn" data-tab="tab-files">Files</button>
          <button class="tab-btn" data-tab="tab-tests">Tests</button>
          <button class="tab-btn" data-tab="tab-launch">Launch</button>
        </div>
        <div class="tab-content">
          <div id="tab-output" class="tab-pane active">Latest output will appear here.</div>
          <div id="tab-walkthrough" class="tab-pane">No walkthrough yet.</div>
          <div id="tab-files" class="tab-pane">No changed files.</div>
          <div id="tab-tests" class="tab-pane">No test results.</div>
          <div id="tab-launch" class="tab-pane">
            <div id="launch-url-container" style="margin-bottom: 8px; font-weight: 600;">No app launch URL recorded.</div>
            <pre id="launch-logs-container" class="terminal-logs">No launch logs yet.</pre>
          </div>
        </div>
      </section>

      <section class="chat-section">
        <div class="sub-panel-title" style="margin-bottom: 8px;">Chat</div>
        <div class="messages" id="messages"><div class="empty">Loading conversation...</div></div>
      </section>

      <!-- Hidden deprecated elements to maintain compatibility/avoid query errors -->
      <div style="display:none;">
        <select id="conversation-select"></select>
        <button id="new-task-dup"></button>
        <div id="queue-line"></div>
        <div id="latest-output"></div>
        <div id="preview-panel"></div>
        <div id="tasks"></div>
      </div>
    </main>
  </div>
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
      <div class="sheet-label">Initial prompt <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#657086;">(optional)</span></div>
      <textarea class="sheet-textarea" id="sheet-prompt" placeholder="What should Orion build or work on?" rows="3"></textarea>
      <button class="sheet-start-btn" id="sheet-start" type="button">Start Task</button>
    </div>
  </div>
  <div class="form-mode-bar" id="form-mode-bar">
    <span class="mode-icon">&#x25B6;</span>
    <span class="mode-label" id="form-mode-label">Steering</span>
    <button class="mode-cancel" id="form-mode-cancel" type="button">Cancel</button>
  </div>
  <form id="prompt-form"><div class="composer"><textarea id="prompt" placeholder="Ask Orion..." autocomplete="off" rows="2"></textarea><button class="send-button" id="send" type="submit">Send</button></div></form>
  <script>
    const pairingCode = ${JSON.stringify(pairingCode)};
    const sessionKey = 'orionPhoneCompanionSession';
    let deviceSession = null;
    try { deviceSession = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch (e) { deviceSession = null; }

    const messagesEl = document.getElementById('messages');
    const metaEl = document.getElementById('meta');
    const modelEl = document.getElementById('model');
    const statusEl = document.getElementById('status');
    const statusPillEl = document.getElementById('status-pill');
    const planPanelEl = document.getElementById('plan-panel');
    const approvePlanEl = document.getElementById('approve-plan');
    const denyPlanEl = document.getElementById('deny-plan');
    const revisePlanEl = document.getElementById('revise-plan');
    const refreshStateEl = document.getElementById('refresh-state');
    const stopTaskEl = document.getElementById('stop-task');
    const resumeTaskEl = document.getElementById('resume-task');
    const newTaskEl = document.getElementById('new-task');
    const steerTaskEl = document.getElementById('steer-task');
    const projectSelectEl = document.getElementById('project-select');
    const projectCountBadgeEl = document.getElementById('project-count-badge');

    // New Console elements
    const globalIndicatorBanner = document.getElementById('global-indicator-banner');
    const activeTaskContainer = document.getElementById('active-task-container');
    const attentionTasksContainer = document.getElementById('attention-tasks-container');
    const queuedPromptsContainer = document.getElementById('queued-prompts-container');
    const recentTasksList = document.getElementById('recent-tasks-list');
    const missionContextCard = document.getElementById('mission-context-card');
    const missionContextRevision = document.getElementById('mission-context-revision');
    const missionContextTitle = document.getElementById('mission-context-title');
    const missionContextObjective = document.getElementById('mission-context-objective');
    const missionContextConditions = document.getElementById('mission-context-conditions');
    const missionContextBlockers = document.getElementById('mission-context-blockers');

    const installTipEl = document.getElementById('install-tip');
    const form = document.getElementById('prompt-form');
    const promptEl = document.getElementById('prompt');
    const formModeBar = document.getElementById('form-mode-bar');
    const formModeLabel = document.getElementById('form-mode-label');
    const formModeCancel = document.getElementById('form-mode-cancel');
    const sheetOverlay = document.getElementById('sheet-overlay');
    const newTaskSheet = document.getElementById('new-task-sheet');
    const sheetClose = document.getElementById('sheet-close');
    const projGrid = document.getElementById('proj-grid');
    const sheetPrompt = document.getElementById('sheet-prompt');
    const sheetStart = document.getElementById('sheet-start');
    const ctxRunning = document.getElementById('ctx-controls-running');
    const ctxIdle = document.getElementById('ctx-controls-idle');

    let lastSignature = '';
    let projectSelectInitialized = false;
    let lastProjectOptionsSignature = '';
    let currentConversationId = '';
    let formMode = 'prompt'; // 'prompt' | 'steer' | 'revise'
    let availableProjects = [];
    let selectedSheetProject = '';

    // ── Simple markdown renderer ──────────────────────────────
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

    // ── Form mode (steer / revise / prompt) ──────────────────
    function setFormMode(mode) {
      formMode = mode;
      if (mode === 'steer') {
        formModeBar.className = 'form-mode-bar visible';
        formModeLabel.textContent = 'Steering active work';
        promptEl.placeholder = 'How should Orion adjust its approach?';
        promptEl.focus();
      } else if (mode === 'revise') {
        formModeBar.className = 'form-mode-bar revise-mode visible';
        formModeLabel.textContent = 'Revising plan';
        promptEl.placeholder = 'What should change in the plan?';
        promptEl.focus();
      } else {
        formMode = 'prompt';
        formModeBar.className = 'form-mode-bar';
        promptEl.placeholder = 'Ask Orion...';
      }
    }
    formModeCancel.addEventListener('click', () => setFormMode('prompt'));

    // ── New Task Sheet ────────────────────────────────────────
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

        // 1. Render Globally Running / View Indicator
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

        // 2. Render Active Task Card
        const activeConv = (state.conversations || []).find(c => c.id === viewingId);
        if (activeConv) {
          const isRunning = globalRunning && runningId === viewingId;
          const statusText = isRunning ? 'Running' : (activeConv.awaitingPlanApproval ? 'Needs Attention' : 'Idle');
          const badgeClass = isRunning ? 'success' : (activeConv.awaitingPlanApproval ? 'warning' : 'muted');

          activeTaskContainer.innerHTML = \`
            <div class="card-header">
              <span class="sub-panel-title">Current Task View</span>
              <div style="display:flex; gap:6px;">
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

        // Mission-level context follows the selected conversation without exposing discarded noise.
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

        // 3. Needs Attention / Plan Waiting Tasks
        const attentionTasks = (state.conversations || []).filter(c => c.awaitingPlanApproval);
        if (attentionTasks.length > 0) {
          attentionTasksContainer.innerHTML = attentionTasks.map(c => {
            const isViewing = c.id === viewingId;
            return '<div class="dashboard-card attention-card">' +
              '<div class="card-header">' +
                '<span class="badge warning">Plan Awaiting Approval</span>' +
                (isViewing ? '<span class="badge active-view">Viewing</span>' : '') +
              '</div>' +
              '<div class="card-title">' + escapeHtml(c.title) + '</div>' +
              '<div class="card-actions" style="margin-top: 8px;">' +
                (isViewing ? '' : '<button class="btn-sm" onclick="switchTask(\\\'' + escapeHtml(c.id) + '\\\')">Switch to Approve</button>') +
              '</div>' +
            '</div>';
          }).join('');
        } else {
          attentionTasksContainer.innerHTML = '';
        }

        // 4. Queued Prompts
        if (state.queuedPrompts > 0) {
          queuedPromptsContainer.innerHTML = \`
            <div class="sub-panel-title">Queued Prompts (\${state.queuedPrompts})</div>
            <div class="queued-list">
              \${(state.queuedPromptPreview || []).map(p => '<div class="queued-item">' + escapeHtml(p) + '</div>').join('')}
            </div>
          \`;
          queuedPromptsContainer.style.display = 'block';
        } else {
          queuedPromptsContainer.style.display = 'none';
        }

        // 5. Recent Tasks List
        if (state.conversations && state.conversations.length > 0) {
          recentTasksList.innerHTML = state.conversations.map(c => {
            const isViewing = c.id === viewingId;
            const isRunning = globalRunning && c.id === runningId;
            const isAwaiting = !!c.awaitingPlanApproval;

            let badgesHtml = '';
            if (isViewing) badgesHtml += '<span class="badge active-view" style="margin-left:4px;">Viewing</span>';
            if (isRunning) badgesHtml += '<span class="badge success pulse" style="margin-left:4px;">Running</span>';
            if (isAwaiting) badgesHtml += '<span class="badge warning" style="margin-left:4px;">Attention</span>';
            if (!isViewing && !isRunning && !isAwaiting) badgesHtml += '<span class="badge muted" style="margin-left:4px;">Ready</span>';

            const timeText = new Date(c.updatedAt || 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return '<div class="task-row' + (isViewing ? ' active-row' : '') + '" onclick="switchTask(\\\'' + escapeHtml(c.id) + '\\\')">' +
              '<div class="task-row-left" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:8px;">' +
                '<div class="task-row-title" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + escapeHtml(c.title) + '</div>' +
                '<div class="task-row-meta">Updated: ' + timeText + ' - ' + c.taskCount + ' items</div>' +
              '</div>' +
              '<div class="task-row-right" style="display:flex; align-items:center;">' +
                badgesHtml +
              '</div>' +
            '</div>';
          }).join('');
        } else {
          recentTasksList.innerHTML = '<div class="empty">No tasks in workspace.</div>';
        }

        // 6. Upgraded Activity Tab Content
        const preview = state.preview || {};
        document.getElementById('tab-output').textContent = preview.latestAssistantOutput || 'No assistant output yet.';

        const walkthroughPane = document.getElementById('tab-walkthrough');
        walkthroughPane.textContent = preview.workWalkthrough || 'No walkthrough yet.';

        const filesPane = document.getElementById('tab-files');
        if (Array.isArray(preview.changedFiles) && preview.changedFiles.length) {
          filesPane.innerHTML = preview.changedFiles.map(f => '<div style="margin-bottom:4px; font-family: monospace; font-size: 0.72rem;">' + escapeHtml(f) + '</div>').join('');
        } else {
          filesPane.textContent = 'No changed files recorded.';
        }

        const testsPane = document.getElementById('tab-tests');
        if (Array.isArray(preview.testResults) && preview.testResults.length) {
          testsPane.innerHTML = preview.testResults.map(r => '<div class="test-result-block" style="font-family: monospace; white-space: pre-wrap;">' + escapeHtml(r) + '</div>').join('');
        } else {
          testsPane.textContent = 'No test results recorded.';
        }

        const launchUrlContainer = document.getElementById('launch-url-container');
        if (preview.appLaunchUrl) {
          launchUrlContainer.innerHTML = '<strong>Launch URL:</strong> <a href="' + escapeHtml(preview.appLaunchUrl) + '" target="_blank" style="color:var(--accent); text-decoration:underline;">' + escapeHtml(preview.appLaunchUrl) + '</a>';
        } else {
          launchUrlContainer.textContent = 'No app launch URL recorded.';
        }

        const launchLogsContainer = document.getElementById('launch-logs-container');
        launchLogsContainer.textContent = preview.appLaunchLogs || 'No launch logs yet.';

        const projects = Array.isArray(state.projects) ? state.projects : [];
        availableProjects = projects;
        projectCountBadgeEl.textContent = projects.length + (projects.length === 1 ? ' Project' : ' Projects');

        // Keep hidden select in sync for compatibility
        const projectOptionsSignature = JSON.stringify(projects.map(p => p.path));
        if (projectOptionsSignature !== lastProjectOptionsSignature) {
          projectSelectEl.innerHTML = '<option value="">Standalone conversation</option>' + projects.map(p => '<option value="' + escapeHtml(p.path) + '">' + escapeHtml(p.name) + '</option>').join('');
          lastProjectOptionsSignature = projectOptionsSignature;
        }

        // Update contextual controls visibility
        const isRunning = !!state.running;
        ctxRunning.classList.toggle('visible', isRunning);
        ctxIdle.classList.toggle('visible', !isRunning);

        // 7. Render Messages Feed
        const signature = JSON.stringify({ running: state.running, subStatus: state.subStatus, plan: state.awaitingPlanApproval, conversations: state.conversations, projects: state.projects, messages: state.messages });
        if (signature !== lastSignature) {
          lastSignature = signature;
          messagesEl.innerHTML = !state.messages || state.messages.length === 0 ? '<div class="empty">No messages yet.</div>' : state.messages.map(msg => '<div class="message ' + escapeHtml(msg.role) + '"><span class="role">' + escapeHtml(msg.role) + '</span>' + (msg.role === 'system' ? escapeHtml(msg.text) : renderMarkdown(msg.text)) + '</div>').join('');
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
    promptEl.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });

    // Wire tab clicks
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const parent = btn.closest('.activity-panel');
        parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        parent.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        document.getElementById(targetId).classList.add('active');
      });
    });

    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installTipEl.classList.add('visible'); installTipEl.textContent = 'This companion is installable. Open your browser menu and choose Install app or Add to Home Screen.'; });
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
