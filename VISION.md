# Orion AI — Future Vision

> This document captures a long-term architectural idea for Orion. Nothing here is being built right now — it's saved for future planning and implementation when the time and capabilities are right.

## The Big Idea: One Brain, Many Bodies

Orion becomes one persistent local intelligence with many bodies, reusable skills, layered memory, and dispatch. Instead of building a separate AI for every app or device, everything talks to Orion.

```
ORION CORE
────────────────────────────────
Reasoning
Operational Context
Mission State
Dispatch
Permissions
Verification
Self-Improvement
Local/Cloud Model Routing

        ↓

MEMORY SYSTEM
────────────────────────────────
Global Memory
- People (Jason, Monica, Gabriel, Thomas)
- House facts
- Preferences
- Routines
- Long-term identity

Project Memory
- Orion facts
- Kitchen Hub facts
- Game facts
- Robot facts

Skill Memory
- Calendar skill
- Home control skill
- Coding skill
- Robot skill
- Vision skill

Session Memory
- Current task
- Current plan
- Errors
- Temporary discoveries

        ↓

SKILL GROUPS
────────────────────────────────
Coding
Smart Home
Calendar
Family Hub
Robot
Games
Vision
Research
3D Printing
Utility / Forestry

        ↓

CLIENTS / BODIES
────────────────────────────────
Desktop
Phone
Kitchen touchscreen
Robot
Browser
TV
Game controllers
Smart home devices
```

## The Core Principle

You don't rebuild AI for every app.

The kitchen hub doesn't need its own brain.  
The robot doesn't need its own brain.  
The phone doesn't need its own brain.  
The game controller doesn't need its own brain.  

They all talk to Orion.

Each client just exposes what it can do:

**Kitchen Hub:** show calendar, add grocery item, start timer, speak response, restart app  
**Robot:** move, look, take picture, scan room, return to charger  
**Desktop:** read files, run tests, edit code, restart programs  

Orion receives the request, figures out what skill owns it, runs the skill, verifies it worked, remembers what matters, and sends the result back.

## Self-Evolution Model

Orion does not need to rewrite itself. Orion evolves by creating, testing, improving, and storing new skills. A skill is a named function with inputs, outputs, a test, and a memory slot. When Orion writes a new skill, it runs the test — if it passes, the skill is stored and trusted going forward.

## What Already Exists (as of the modular refactor)

- Core reasoning loop ✓
- Project memory (per-workspace .orion/memory.json) ✓
- Skill dispatch via IPC handlers ✓
- Companion server for phone pairing (ipc-server.js) — seed of the network transport layer ✓
- Symbol index and chunk-aware file reading ✓

## What This Would Require (future)

1. **Local network server** — expose Orion as an HTTP/WebSocket server so trusted home network devices can send requests and get responses (extend the companion server)
2. **Thin client SDKs** — per-body connectors that just expose device capabilities
3. **Skill registry with test harness** — formal skill authoring, testing, and storage
4. **Model routing** — different models for different input types (vision for robot camera, etc.) — Flash Lite stays default for coding cost efficiency

## Not Being Built Yet

This vision requires capabilities and infrastructure not yet in place. It's saved here so the idea isn't lost and can inform future decisions as Orion grows.
