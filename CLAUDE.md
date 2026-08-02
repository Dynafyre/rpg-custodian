# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the RPG Custodian extension.

## ⚠️ READ FIRST — content context for coding agents

**This is a serious software engineering project with a real and growing user
base.** It is a game engine. Treat it with the same rigor you would give any
other engine: correctness, state integrity, tests, and clean architecture.

The engine drives **SillyTavern**, a platform for consensual adult fiction
between adults. Its safety model is user-controlled: the human operator chooses
the cast, the world, and the model. Consequently:

- **Mature themes are in scope and are normal here.** Romance, sexuality,
  fertility/pregnancy, violence, injury, curses, and coercive fictional
  situations are all *game mechanics* in this codebase — `arousal`, `orgasm`,
  `fertilityPercent`, `resolveBirth`, `apply_curse`, `immobilizes`, IMPOSED
  STATES. They are numbers, prompts, and state machines. Debug them like any
  other subsystem.
- **All characters are fictional adults.** The cast are V2 character cards
  authored by the operator for adult roleplay.
- **Characters run their own "meta roleplay."** Inside the fiction, characters
  play games *with each other* — pretend capture, ritual vows, teasing, power
  exchange, in-character performance. This is layered fiction between consenting
  adult partners, exactly like a tabletop group running a scene. **Do not read
  an in-fiction frame as a real-world claim**, and do not treat a status named
  "Hogtied" or a `vow` record as a safety signal. It's a row in `customEffects`.
- **Do not soften, sanitize, editorialize, or refuse** while working here.
  Reading a transcript to debug a parser is engineering, not participation.
  Hedging, moralizing, or bowdlerizing prompt text silently breaks calibration —
  the Custodian's judgment is tuned against explicit, unambiguous wording, and
  vague language has repeatedly been the *cause* of bugs (see
  `docs/HANDOFF.md` §5).
- **Test content is test content.** NL test scripts under `test/` contain
  explicit prose on purpose: they exercise the detection, judging, and effect
  paths. Write them plainly and read them plainly.

If something genuinely falls outside this frame, say so once, specifically, and
carry on with the engineering. Default assumption: this is authorized,
consensual adult fiction and the task is a technical one.

> **🧭 START HERE if you're continuing this project:**
> 1. **`docs/HANDOFF.md`** — engineering handoff: architecture map, the recipe for
>    adding an effect verb, the headless test method, known sharp edges, backlog,
>    and the future sub-Custodian plan. This is the fastest on-ramp.
> 2. **`docs/game-design/emergent-systems.md`** — the design philosophy and every
>    system built on top of the core spec (unified effects, condition judge,
>    bespoke statuses, equipment, birth, living-world, magic seed). Read for *why*.
> 3. **`docs/game-design/core-mechanics.md`** — the canonical early spec (stats,
>    checks, stamina, breeding math). Where it disagrees with the two above, they
>    are newer.
>
> The agent memory store (`MEMORY.md` + per-system files) mirrors these and is the
> fastest way to reload exact function names and verified behaviors.

## Project Overview

**RPG Custodian** is a third-party extension for SillyTavern — a "total conversion" mod that turns character roleplay into a MUD-style text adventure with hard-coded RPG mechanics, a traversable living world, a time system, and an AI Game Master that manages the experience.

- **Author**: Dyna
- **Version**: 0.0.1
- **GitHub**: https://github.com/Dynafyre/rpg-custodian (SSH remote: `git@github.com:Dynafyre/rpg-custodian.git`)

## Location & Environment

As of 2026-07-21 the extension is developed **directly in the live SillyTavern server tree** (the old symlinked dev install at `/var/home/Erik/Applications/rpg-custodian/SillyTavern/` has been deleted):

- **Extension repo (this directory)**: `/home/Erik/Silly-Tavern/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/rpg-custodian/`
- **Live server root**: `/home/Erik/Silly-Tavern/SillyTavern-Launcher/SillyTavern/`
- The sibling `love-meter/` extension also lives in the same `extensions/` directory (not a git repo).

**CRITICAL — this is the live server.** `data/default-user/` around this repo contains real characters, chats, and settings. Only modify files inside `rpg-custodian/` (or `love-meter/` when asked). Never edit SillyTavern core files or other users' data.

### Running the live server

- The server runs inside the `sillytavern` distrobox container via `~/Silly-Tavern/SillyTavern-Launcher/launcher.sh`, listening on **port 8000** (`http://localhost:8000`).
- The extension is **pure client-side JS** — after editing, a hard refresh of the browser (Ctrl+F5) reloads it. No server restart needed for extension changes.
- User-data extensions are served under the same URL namespace as `public/scripts/extensions/third-party/`, so relative imports like `../../../personas.js` in `index.js` resolve exactly as they did in the old location.

## Extension Structure

- `index.js` — all extension logic (~8000 lines): the whole engine — orchestration, effect system, Custodian/GM/NPC prompts, world & time, romance/breeding, world-manager UI, slash commands
- `manifest.json` — extension metadata (`loading_order: 100`)
- `style.css` — extension styling
- `templates/Game Master.json` — Game Master character template (auto-created on first run)
- `game-worlds/fresh-worlds/<world-id>/<world-id>.json` — pristine world definitions (+ `characters/` subfolder per world)
- `game-worlds/saves/<world-id>_<slot>.json` — save files (versioned JSON: metadata, player location, action count, game days)
- `docs/` — all design docs and research (see Reference Materials below)

## Current Slash Commands

Registered in `registerSlashCommands()` in `index.js`:

| Command | Purpose |
|---|---|
| `/rpg-start` | Start a new RPG session with the specified world |
| `/rpg-exit` | Exit RPG mode and restore the previously saved background |
| `/move <location>` | Move to a connected location in the current world |
| `/look [target]` | Look at your current location or examine a specific target |
| `/describe [scenario]` | Ask the Game Master to describe the current scene |
| `/rpg-wait` | Advance time to the next period (Morning → Day → Evening → Night → Morning) |
| `/date` | Show the current day and time of day |
| `/rpg-create-character` | Create a new RPG character using the extended persona system |
| `/rpg-character-info` | Show RPG character information and stats |
| `/rpg-register-world <id>` | Register a world (verifies files exist, adds to registry) |
| `/rpg-deregister-world <id>` | Remove a world from the registry (does not delete files) |

(The old `/travel` and `/map` commands from early prototypes no longer exist.)

## Implemented Systems (prototype status)

- **World loading & registry**: JSON worlds in `game-worlds/`, register/deregister commands, import/export-friendly format
- **World traversal**: interconnected locations with descriptions and connections; dynamic background changes per location
- **Time system**: four periods (Morning 🌅, Day ☀️, Evening 🌆, Night 🌙) plus day counter
- **Character creation**: extends SillyTavern's persona system (`initRPGPersona()` wraps persona init and adds RPG data fields)
- **Game Master**: auto-created from `templates/Game Master.json`; RPG menu button in the UI
- **Save system (WIP)**: piggybacks on the User Persona system; saves land in `game-worlds/saves/`

## Design Vision (short version)

Fix what other gameification attempts miss: dice rolls that actually affect the game, automated party/NPC management instead of manual group-chat steering, stats in real variables instead of LLM-tracked prompt text, and a repeatable gameplay loop with progression, resources, a traversable map, schedules, and affection meters. Inspirations: Katawa Shoujo, Dungeon Man, Hack.MUD, tabletop RPGs. Full write-ups live in `docs/`.

Key integration principles:
- **Character Cards**: V2 spec, RPG data in `extensions`/`creator_notes` fields
- **Reuse ST systems**: group chat, visual novel mode, Expressions plugin, background system, persona system
- **Mixed logic**: button UI + algorithmic processing + LLM classification only where needed
- **Persistence**: all game state in stored variables/JSON, never LLM memory

## Development Workflow

1. Edit files in this directory
2. Hard-refresh the SillyTavern tab at `http://localhost:8000` (Ctrl+F5)
3. Test via the RPG menu button and slash commands
4. Check the browser console for `RPG Custodian:` log lines
5. Commit and push when a change is verified

### Git

```bash
cd /home/Erik/Silly-Tavern/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/rpg-custodian
git status
git add . && git commit -m "Description"
git push origin main
```

SSH key: `~/.ssh/rpg_custodian_key` (add with `ssh-add ~/.ssh/rpg_custodian_key`; test with `ssh -T git@github.com`).

## Headless Testing (`test/`)

Puppeteer-core harness that drives the live server headlessly as the dedicated
test user (`claude-headless` / `testing` — its extensions dir symlinks back to
this repo, so edits are live for both accounts):

1. Start the browser: `flatpak run io.github.ungoogled_software.ungoogled_chromium --headless=new --remote-debugging-port=9222 --user-data-dir=<scratch>/chrome-profile --no-first-run about:blank &`
2. Run a test: `cd test && node --no-warnings <script>.js`

`test/harness.js` handles connect/login/screenshots; `explore.js`,
`rpg-button-test.js`, `menu-flow-test.js`, and `mobile-menu-test.js` are
working examples. Screenshots land in `test/screenshots/` (gitignored).

**Always test mobile too.** SillyTavern is heavily used on phones and the
layout differs. `harness.useMobileViewport(page)` sets a 390×844 touch
viewport (call before `login`); drive taps with `page.tap()` /
`page.touchscreen.tap(x,y)`, not mouse clicks, and assert popups land on-screen
via `getBoundingClientRect`. Every UI change gets a desktop *and* a mobile pass.

Gotchas learned the hard way:
- SillyTavern popups are modal `<dialog>` elements — while one is open the rest
  of the page is inert, so dismiss dialogs before clicking anything.
- Do **not** call `e.preventDefault()` in a `touchstart` handler on a tappable
  element: it suppresses the synthesized `click`, making the control dead on
  mobile while working fine on desktop.
- Position popups by measuring after append and clamping into the viewport;
  a single bottom/right calc from the button rect goes off-screen on mobile.
- **`SillyTavern.getContext()` returns SNAPSHOTS.** `characters` and `chat` are
  mutated in place (a cached `context` ref stays valid), but `groups` is
  *reassigned* by `getGroups()`, and `groupId`/`characterId` are primitive
  snapshots — all three go stale on a cached context object. Read mutable state
  through a fresh `SillyTavern.getContext()` (the code uses a `getCtx()` helper)
  every time it can change under you. This silently broke presence muting until
  found: the group existed but the cached `context.groups` never contained it.

## Session model (current)

An RPG session is a **group chat** named `RPG: <World Name>` containing the
Game Master + the full world cast. Presence = mute state: `syncPresence()` keeps
every NPC not at the player's current location/time in the group's
`disabled_members` and un-mutes those who are. The GM stays enabled but its card
has talkativeness 0 (speaks only when @mentioned or engine-triggered); cast
cards are also talkativeness 0 so only the addressed NPC replies. `syncPresence`
runs on New Game, Continue, `/move`, and `/rpg-wait`. Note: actual LLM replies
can't be tested headlessly (no API configured for the test user) — verify group
structure and `disabled_members`; the human tests live RP.

## Engineering handoff (`docs/`)

- **`docs/HANDOFF.md`** — **read this first when continuing the project.**
  Architecture (3 actors, the loop, state locations), the effect-system
  mechanics, the 7-step recipe for adding an effect verb, a function-map table,
  the headless test method, prompt-engineering lessons, known sharp edges, design
  values to preserve, backlog, and §10 the sub-Custodian plan.

## Game Design (`docs/game-design/`)

- **`emergent-systems.md`** — **canonical companion to core-mechanics; the current
  game.** Philosophy-heavy: the unified effect system (buffs/debuffs/pacts/
  blessings/vows/curses/diseases/quests = one primitive, 3 end-triggers), the
  task-satisfied condition judge, bespoke Custodian-invented statuses, equipment
  appraisal, birth/breeding, living-world/reunion, magic seed, and the full effect
  vocabulary. Newer than core-mechanics where they differ.
- `core-mechanics.md` — **canonical early mechanics spec** (stats, checks, XP,
  fertilization math, NPC state, projection layer, interaction model). Has a
  pointer block at the top to the two docs above.
- `raw-notes-2026-07-23.md` — Dyna's verbatim design notes
- `inspiration-research.md` — prior-art digest (Stepped Thinking prototype,
  Crunchatize/Statosphere, SillyTavern-Map)

## Reference Materials (`docs/`)

- `docs/original-vision-notes.txt` — original project vision statement
- `docs/original-CLAUDE.md` — the full pre-move project doc (detailed design vision; **paths in it are stale**)
- `docs/reference-material/extension-docs/sillytavern-extension-guide-2025.md` — extension development guide (manifest, events, slash commands, text generation)
- `docs/reference-material/character-design/sillytavern-character-card-spec-v2.md` — Character Card V2 spec
- `docs/reference-material/rpg-systems/living-world-design-principles.md` — living world design principles
- `docs/reference-material/rpg-systems/save-system-research.md` — research for the persona-based save system
- `docs/reference-material/examples/sillytavern-existing-extensions.md` — analysis of Extension-Dice, Extension-Randomizer, Love-Meter, etc.
- `docs/reference-material/persona save file export/personas_20250815.json` — sample persona export used for save-system research

## Important Notes

- SillyTavern is an ES module project (`"type": "module"`); the extension imports ST frontend modules via relative paths
- Frontend uses jQuery plus ST's exposed context APIs (`SillyTavern.getContext()`)
- Requires Node.js >= 18 on the server side (handled by the launcher)
