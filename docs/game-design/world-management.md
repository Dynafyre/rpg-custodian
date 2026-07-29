# World Management — Creation, Editing, Import/Export

_Design doc, 2026-07-26, organized from Dyna's vision dump. Status: DESIGNED,
not yet built. This is the authoring layer: everything here serves the goal
that a world author never edits a line of JSON._

## 0. Goals & philosophy

- **Authoring without JSON.** Today only prototype-town is playable, and it
  exists because we hand-wrote its files. Every structure in a world —
  locations, connections, cast, schedules, secrecy — must be creatable,
  editable, and deletable from the UI.
- **Touch-first.** The map builder especially is a full-screen, finger-driven
  surface (SillyTavern lives on phones). Every interaction below must pass the
  390×844 test like the rest of the extension.
- **Shareable.** A world plus its cast (and optional lorebook) exports as one
  bundle another player can import, with graceful name-conflict handling.
- **Compatible.** Any standard V2 character card (JSON or PNG) can be brought
  into a world through a formatting wizard that makes it RPG-Custodian-ready.

## 1. The World Manager (list popup)

Entry from the RPG menu: **Worlds** → a popup listing all installed worlds,
each row: name, cast count, location count, last-played. Buttons:

- **Create** → the Creation Wizard (§2).
- **Import** → world-bundle import (§6).
- **Edit** → reopens the same wizard screens for an existing world (§5).
- **Delete** → confirm dialog (type-the-name style for safety), removes the
  world's folder/registry entry. Saves referencing it are flagged, not
  silently broken.
- **Export** → bundle download (§6).

## 2. The Creation Wizard

A stepper; each step is also independently reachable in Edit mode:

1. **World basics** — name, id (auto-slugged), description, starting
   location (chosen later from the map, defaulted to first node).
2. **Map builder** — §3, the big one.
3. **Cast onboarding** — §4, per-character wizard.
4. **Extras & finalize** — optional World Info (lorebook) file to bundle,
   review summary, create.

## 3. The graphical map builder

Full-screen canvas, touch-optimized.

### 3.1 Canvas & background
- **Custom background image** upload (stored in the world's folder) — a drawn
  map, a photo, anything. No image = plain grid.
- **Pinch-zoom & pan.** Nodes are anchored to image coordinates, so they stay
  pinned to their spot on the map at every zoom level.
- **Node scale slider** (submenu): adjusts relative node size vs. the image,
  for dense or sparse maps.

### 3.2 Nodes & selection
- **Node = location.** Tap empty space (or a ➕ button) to create; drag to
  reposition; tap to select. Multi-select by tapping additional nodes.
- **Contextual top bar** changes with selection count:
  - **None selected:** Create Node · background/image options · node scale.
  - **One selected:** **Edit Location** (§3.3) · Delete · Connect-mode.
  - **Two+ selected:** **Join** (creates connections among selected — no JSON
    line-editing ever) · Unjoin · Delete.
- Connections render as lines between nodes; tapping a line offers delete.

### 3.3 Edit Location panel
Fields: **name**, **alternate names** (the fuzzy-match aliases doNlMove
already supports — "the Rose" for The Velvet Rose), **description**, **tags**
(danger level and shop categories will live here later — TODO §3/§4/§6),
**background** (per-location scene background, as today), and **secret
level** (§3.4).

### 3.4 Location secrecy (mirrors the NPC `secret` flag)

**Principle (Dyna's clarification):** the Custodian ALWAYS knows every
location, secret or not. It is a silent arbiter — all player-facing prose is
subletted to the GM and NPCs — so a secret held in its context cannot leak.
Secrecy is applied at the LEAKY surfaces only: NPC/GM context and the
player-facing menus. Keeping secret places in the Custodian's KNOWN PLACES
list also preserves the well-functioning fuzzy destination matching — never
route around it with "verbatim" passthrough.

- **Level 0 — public:** all NPCs know of it (it joins the common-knowledge
  directory alongside people); listed in Move/Look menus.
- **Level 1 — unknown:** NPCs don't know it exists by default (out of the
  common-knowledge directory and NPC context), but it still appears in the
  PLAYER's move options — he found it, they haven't.
- **Level 2 — hidden:** out of global NPC context AND absent from the shown
  Move/Look menus. The Custodian still holds it in KNOWN PLACES, annotated
  simply `(secret: unknown to NPCs, not on the player's menus)` — purely
  informational, no behavioral restriction. If "take me somewhere
  interesting" lands the player at a hidden spring, that's emergent
  discovery working as intended (Dyna's call — no protection clauses).
  **World authors seed clues** to level-2 places in NPC cards and location
  descriptions; the engine keeps the secret out of projections until the
  story finds it.
- (Engine support for secrecy is independent of the editor and can ship
  first — it's small and immediately useful for prototype-town.)

## 4. Cast onboarding (character wizard)

Per character, accepting **standard V2 cards (JSON or PNG)**:

1. **Upload** the card. Parse; show identity preview.
2. **RPG-ify** — a form writing the `rpg_custodian` extensions block:
   - **Home** (pick a node on this world's map) and **schedule** (per time
     period: which location — a simple 4-column picker).
   - **Stats:** fertility %, ruggedness, race, age, wrestle DC, etc.
   - **Secret** flag (out of the common-knowledge directory).
   - **Shop** category if merchant (feeds TODO §6 merchants).
   - **Card hygiene:** offer recommended world-coherency snippets to insert
     into card fields, and warn about location-anchored description text (the
     "always perched behind the counter" lesson — the wizard should flag
     phrases like that for removal).
3. **Expressions** — optional sprite pack upload (standard = zip), wired to
   ST's sprites system for the character.
4. Repeat per character; cast list with edit/remove per entry.

## 5. Editing

Everything above is re-enterable: World Manager → Edit → jump to any wizard
step. Character edits re-use the onboarding form. Deleting a location that
NPCs reference (home/schedule) warns and offers reassignment. Bump
`card_version` automatically on character edits so live cards self-heal.

## 6. Export / Import

- **Export:** one bundle containing the world JSON (map image included), all
  cast cards, optional World Info file. Format: a zip (or single-JSON with
  embedded base64 assets — decide in implementation) named
  `<world-id>.rpgworld`.
- **Import:** validates the bundle, then **name-conflict handling**: if a
  world or character name already exists locally, a popup text box prompts a
  rename before anything is written — no silent overwrites, no aborts.
  Characters renamed at import get their world's cast list updated to match.
- Optional World Info file imports through ST's world-info API and binds like
  the auto-created RPG lorebook.

## 7. Technical notes / open implementation questions

- **Storage:** worlds currently live as static files in the extension folder,
  which the client cannot write. Options: (a) keep files, add writes via ST's
  user-file/asset APIs; (b) move world definitions into `extensionSettings`
  (pure client, no file writes) with images via ST's background/asset APIs.
  Leaning (b) for authored worlds + keeping (a) as the read-only "shipped
  worlds" path — decide at build time.
- **Map data:** nodes gain `x`,`y` (image-relative 0–1 coords); world gains
  `mapImage`, `nodeScale`. Play-mode is unaffected (map data is editor-only
  until a play-mode map screen exists someday).
- **Character PNG import/export** rides ST's existing character APIs;
  expressions zips ride the sprites upload API.
- **Registry** (`/rpg-register-world`) absorbs into the World Manager; slash
  commands remain as power-user shortcuts.

## 8. Build order (proposed)

1. **Location secrecy engine support** (levels 0/1/2 wired into directory,
   menus, analyzer, doNlMove) — small, ships value immediately.
2. **World Manager popup** + storage decision + Delete + registry absorption.
3. **Map builder** (the largest single piece; ship view/edit of existing
   prototype-town first, then creation).
4. **Cast onboarding wizard** (V2 import + RPG-ify + expressions).
5. **Creation wizard shell** stitching 2–4 into a stepper.
6. **Export/Import bundles** with conflict handling.

Each phase gets desktop + mobile headless passes (the map builder especially
is a touch-interaction test suite of its own).
