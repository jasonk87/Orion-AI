# Mayor-Life Project Review

## What It Is

A third-person ancient Egypt kingdom sim in Three.js + React. You physically walk the map as the ruler, place buildings, meet nobles face to face, and watch workers haul stone. The design docs (VISION.md, implementation_plan.md) are unusually well-thought-out for a solo project.

---

## What's Actually Built

Nearly everything in the vision doc is real inside `PyramidBuilderGame.js` (17,110 lines):

- Third-person movement, sprint, jump, mouse-look
- 1,800 instanced worker meshes (single draw call — correct approach)
- Full production chain: farmers → food, miners → stone, haulers → pyramid
- Staged construction with physical scaffolding and builder agents
- Named nobles with personalities, daily utility, estate households, charters
- Full dynasty system: marriage via envoys, pregnancy, births, succession, regency, permadeath
- Assassination: motive/means/opportunity → physical clues → bodyguard interception → ruler wounds/death
- Save/load via localStorage
- Day/night, seasons (Inundation/Sowing/Harvest), sandstorms, heatwaves
- Wildlife (crocodile, baboon, lion), discoveries/relics
- Military units (spearman, archer, swordsman, commander) with guard modes
- Scribe's Ledger UI with resource, blueprint, and military tabs

This is legitimately impressive scope for a single file.

---

## Dead Code — Delete These

These files are either orphaned prototypes or AI-generated stubs. Nothing imports them:

- `LivingMayorGame.js` — older prototype
- `ArenaLegendsGame.js` — older prototype  
- `MilitaryUnit.js` — stub, never imported
- `BuildingController.js` — stub, never imported
- `EconomyManager.js` — stub, never imported

All real systems live inside `PyramidBuilderGame.js`.

---

## What's Rough

**17k-line God Class** — the entire simulation, rendering, NPC AI, dynasty logic, UI, and save system are one file with no module boundaries. Works now, but it's increasingly expensive to extend or debug. Your own `implementation_plan.md` flags this as Immediate Stabilization item #3.

**Zero tests** — `package.json` literally has `"test": "echo \"No tests configured yet.\""`. Dynasty permadeath and conspiracy probability are load-bearing rules you're currently verifying by hand every time something changes.

**No save version field** — any field rename or restructure silently corrupts existing saves. No migration path.

**Two styling systems** — 98 inline `style={{}}` blocks in `main.jsx` alongside a 2,562-line `styles.css`. Inconsistent, hard to maintain a coherent theme.

**Pathfinding is sphere-nudge only** — agents navigate by direct vector movement + basic collision avoidance. Dense building placement will cause agents to clip or get stuck. This is acknowledged in the plan but is becoming a practical limiter.

---

## Where to Go From Here (Priority Order)

### 1. Add save versioning (10 minutes)
Add `saveVersion: 1` to the save blob and a migration check in `_loadGame`. One change, prevents future save-corruption headaches.

### 2. Extract the most modular subsystems
Best candidates in order:
- **`DynastySystem.js`** — `_ensureDynastyState`, `_advanceDynastyDay`, `_birthRoyalChild`, `_killRuler`, etc. are already logically cohesive (~200 lines). Extract first.
- **`ConspiracySystem.js`** — plot readiness, evidence, confrontation flow is another natural seam.
- **`Worker.js` and `Player.js`** — already cleanly defined as standalone classes inside the file. Just move them.

### 3. Write tests for dynasty and succession
A Jest test for `_killRuler` (with/without an heir) and `_advanceDynastyDay` (age progression, pregnancy) would catch the bugs you're currently catching by hand. These rules are too important to leave untested.

### 4. Copper/stone logistics
Per your own roadmap, these still lack the finite-deposit + physical-cart model that timber and clay already have. That's the next production-chain gap.

### 5. Pathfinding upgrade
Before adding more building types, a simple flow-field or navmesh would prevent agents clipping through dense placements. This becomes more painful the more buildings the player can place.

### 6. Consolidate styles
Move all 98 inline `style={{}}` blocks to semantic class names in `styles.css` (`.ledger-sandstorm`, `.court-scheme-card`, etc.). Pure cleanup but it matters for maintaining a consistent theme.

---

## Summary

The project is substantially further along than most solo game prototypes at this scale. The simulation depth — noble households, conspiracy chains, physical evidence, dynasty continuity — is genuinely impressive for the codebase size. The main risk is the 17k-line monolith becoming too expensive to change. Start extracting now while the seams are still clearly visible.
