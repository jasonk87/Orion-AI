# Orion AI

Orion AI is a local Electron pair-programmer app powered by Gemini/Ollama, workspace-aware tools, command execution, web research, durable notes, and model-aware context compaction.

## Setup

1. Install dependencies:

```powershell
npm install
```

2. Create local config:

```powershell
Copy-Item config.example.json config.json
```

3. Edit `config.json` with local API keys and preferences.

## Run

```powershell
npm start
```

## Package

```powershell
npm run package
```

The packaged Windows app is written to `dist/OrionAI-win32-x64`.
