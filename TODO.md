# RPG Custodian — TODO / Roadmap

_Captured 2026-07-25 from Dyna's direction. This absorbs and extends the backlog
in `docs/HANDOFF.md` §9. Each item lists the goal, what exists today, and the
open design questions to settle before building. Order below is roughly
"top of mind" priority, not dependency order — but note the **Unified Economic
Scale (§6a)** and **NPC levels (§3)** are load-bearing inputs to several others._

---

## 1. Romance & relationship feel pass 💕

**➡️ DESIGNED — full plan in `docs/game-design/romance-redesign.md`** (audit
done 2026-07-25; affection was only moving on proposition charm checks ±1,
causing the failed-cuddle-check dissonance).

**The four pillars — ✅ ALL IMPLEMENTED 2026-07-25**
(test/romance-redesign-test.js 10/10; knobs: +1 aff/period pacing cap, ±2
extremes, arousal ±2/turn −1/period decay, post-coital stamina valve):
- [x] **A. Verbose tier projection with behavioral ceilings**
- [x] **B. Charm decoupled from affection** (+interpretation note,
      her-initiative-never-rolls, lane-narrowed verbs)
- [x] **C. Reaction judge** (band-break detection, pacing cap, tier-crossing
      ghost lines)
- [x] **D. Arousal with teeth** (ladder, decay, DC discount, stamina valve)
- [ ] **Live playtest feedback pass** — Dyna plays the courtship arc; tune
      judge strictness / band wording from real transcripts.
- [ ] **Interaction with NPC difficulty (§3)** — a dragon queen at Wary should
      not share DCs with a village girl at Wary (unchanged, still pending §3).

---

## 2. Progression: spending XP & Power Tokens ⚡

**Goal:** Close the loop — XP and Power Tokens accumulate but currently buy
nothing, so power scaling doesn't exist yet.

**Exists today:** XP from encounters + check trickle; leveling concept (raise a
stat) specced in core-mechanics §5 but no spend UI/flow; Power Tokens awarded
per birth, zero sinks (open question since core-mechanics §13).

**Needs design & build:**
- [ ] **XP → level-up flow** — threshold table, and the *choose a stat to raise*
      moment (UI on the character sheet? GM-narrated milestone?). Bounded so
      stats grow slowly (a +1 is meaningful on 2d6).
- [ ] **Power Token sinks** — decide what tokens buy. Candidates from prior
      notes: spell unlocks (ties into §7), stat-cap raises, world perks,
      Virility increases. Pick 2–3, not everything.
- [ ] **Where spending happens** — character sheet buttons? A special vendor?
      Keep it engine-owned (deterministic costs), never Custodian-priced.
- [ ] **Surface progression state** — XP-to-next-level visible on the sheet;
      token count already shown(?) — verify.

---

## 3. NPC difficulty rating / level system 📊

**Goal:** Every girl (and hostile NPC) carries a difficulty rating so players
can read at a glance whether an interaction is suited to them or beyond them.

**Needs design & build:**
- [ ] **The rating itself** — a single level? A tier badge (harmless / tricky /
      dangerous / deadly / legendary)? Derive from her stats or author it on the
      card (`rpg_custodian.level`)? Probably: authored level → derived stats.
- [ ] **Player-facing warning** — where it surfaces: `/look`, examine, the
      status block, group-member list. Color/icon coding relative to *player*
      level (green/yellow/red).
- [ ] **Mechanical teeth** — difficulty should feed Charm DCs (§1), combat
      stats (§5), and XP rewards (harder conquest = more XP, already the design
      intent in core-mechanics §5).
- [ ] **Backfill the existing cast** — prototype-town NPCs need ratings.

---

## 4. Areas, danger levels & encounter system 🗺️

**Goal:** Encounters become area-dependent — each location gets a danger level,
and a new encounter system spawns appropriate content there.

**Needs design & build:**
- [ ] **Area danger rating** — a field on world-JSON locations (safe / low /
      mid / high / deadly). Town square = safe; deep woods = dangerous.
- [ ] **Encounter system** — what triggers an encounter: travel into an area?
      Time passing there? A `/explore`-style action? Weighted by danger level.
      Decide engine-rolled (deterministic table per area) vs Custodian-generated
      (invented from area description + danger budget) — likely engine rolls
      *whether/how dangerous*, Custodian invents *what*, same division of labor
      as everywhere.
- [ ] **Encounter ↔ NPC-level coupling** — spawned threats scale to area danger
      (§3's rating scale reused), so danger ratings honestly warn the player.
- [ ] **Safe-zone guarantees** — no combat encounters in safe areas; social/
      flavor encounters can still fire anywhere.

---

## 5. Combat system with enforced pace ⚔️

**Goal:** Real combat structure. The Custodian already applies damage/debuffs
contextually well — the missing piece is **pace**: whole fights currently get
handwaved in one message (narrative time-dilation). Combat needs an enforced
round rhythm so an encounter takes multiple exchanges to resolve.

**Exists today:** Stamina-as-HP exchange, `damage`/`heal`, contextual debuffs,
the debuff-contest resist template. No initiative, no rounds, no pacing.

**Needs design & build:**
- [ ] **Combat mode with a round clock** — when a fight starts (Custodian emits
      e.g. `begin_combat`?), the engine enters a paced state: each player message
      = one round, one action's worth of resolution. The GM is instructed to
      narrate *only this round*, never the fight's conclusion.
- [ ] **Anti-handwave enforcement** — the enforcement must be *engine-side*
      (per-round damage caps? enemy Stamina pool that can only drop so fast?)
      rather than prompt-side pleading, per project values. An enemy with 6
      Stamina and a per-round cap mechanically cannot die in one message.
- [ ] **Enemy statblocks** — hostile NPCs/monsters need Stamina + stats without
      being full character cards (encounter-spawned mooks from §4). Minimal
      record: name, level (§3 scale), stamina, attack stat, defense stat.
- [ ] **Round structure** — initiative or simple you-then-them? Positioning?
      (Handoff warns: only if it stays inside the effect vocabulary rather than
      becoming a separate mode — tension to resolve: combat *is* somewhat modal
      by nature. Keep the mode thin: a pacing gate, not a new rules engine.)
- [ ] **Ending combat** — victory (enemy stamina 0), flight (a check), surrender
      /parley (social off-ramp back to normal play). KO rules already exist.

---

## 6. Merchants, shopping & the economy 💰

### 6a. Unified economic scale (build FIRST — everything prices off it)
- [ ] **One value scale** that answers: what is a +1 effect worth in gold? What
      should a quest of challenge level N pay? What does a Hard-DC service cost?
      A single table (effect-magnitude → gold band, quest-level → reward band)
      that the appraiser, quest-reward, and stock-generation prompts all cite.
      Engine owns the bands; Custodian picks within them.

### 6b. Shopkeeper identity & tagging
- [ ] **Tag shopkeeper NPCs** with a shop category (SillyTavern tags or card
      field `rpg_custodian.shop`): alchemist → potions, smith → weapons/armor,
      general → tools, enchanter → scrolls, etc. Category drives what their
      stock generator may draw from.

### 6c. Rotating Custodian-generated stock
- [ ] **Weekly stock roll** — every game week, each shopkeeper's inventory
      regenerates: a queued `generateRaw` call (like `appraiseItem`) invents
      N items appropriate to shop category + shop tier, each priced within the
      6a bands. Persist per-save; restock day visible ("new stock on Moonday").
- [ ] **Stock pools** — potions, tools, equipment, weapons, scrolls; rarity
      weighted by shop tier / area (§4).
- [ ] **Prices are engine-truth** — generated once, stored, never re-invented
      in prose. Buying uses existing `buy_item`/gold flow.

### 6d. Inline shop UI
- [ ] **Button-based storefront in chat** — asking a shopkeeper about their
      wares ("what do you have?") makes the Custodian emit e.g. `open_shop`;
      the engine renders an inline card in the chat with the current stock as
      tappable buy buttons (price, effect string, afford-state). Mobile-first
      (390×844 pass mandatory), same click-to-act pattern as inventory.
- [ ] **Haggling?** — optional Charm check for a discount band. Defer if scope
      creeps.

---

## 6.5 World management & authoring 🗺️✍️

**➡️ DESIGNED — full spec in `docs/game-design/world-management.md`**
(2026-07-26). World Manager popup (Create/Import/Edit/Delete/Export), creation
wizard, touch-first graphical map builder (nodes, join, background image,
pinch-zoom, node scale), 3-level location secrecy (public / unknown-to-NPCs /
hidden-but-NL-reachable), V2-card cast onboarding wizard (home, schedule,
stats, secret, expressions zip, location-anchor hygiene), world bundles with
name-conflict handling.

- [ ] Phase 1: location secrecy engine support (independent of editor)
- [ ] Phase 2: World Manager popup + storage decision + delete
- [ ] Phase 3: map builder (view/edit prototype-town first)
- [ ] Phase 4: cast onboarding wizard
- [ ] Phase 5: creation wizard shell
- [ ] Phase 6: export/import bundles + conflict rename

## 7. Spellcasting system ✨

**Goal:** Build the real spell system on the existing seed layer.

**Exists today:** Mana (max = Craftiness), `restore_mana`, soul crystals as
+1-mana fuel, the Crystal Curse contest as the offensive-spell resist template,
`add_status` as the effect template.

**Needs design & build (from HANDOFF §9, still accurate):**
- [ ] **Spell acquisition** — Power Token unlocks (§2 sink), scroll purchases
      (§6 stock pool), quest rewards. A known-spells list on `rpg_data`.
- [ ] **Casting flow** — NL casting judged by the Custodian (`cast_spell` verb),
      mana cost engine-enforced, offensive spells use the debuff-contest,
      beneficial ones apply statuses/heals.
- [ ] **Spell list seed** — a small starter book (thought-inception, enchant
      item, summon, ward, restoration...) each defined as effect-vocabulary
      compositions, so spells are *content*, not new engine code.
- [ ] **Soul-crystal spending** — burn crystals for temp mana over cap or as
      material components for big castings (closes the curse→birth→resource
      loop into a sink).

---

## Cross-cutting notes

- **Dependency sketch:** 6a (economic scale) → 6c/6d and quest rewards; §3
  (NPC levels) → §1 DCs, §4 encounters, §5 combat; §2 (token sinks) ↔ §7
  (spell unlocks). Suggested build order: **3 → 6a → 1 → 2 → 5 → 4 → 6b-d → 7**,
  but each section is independently shippable.
- Every item follows the standing recipe (HANDOFF §2): new verbs taught as
  categories, engine owns numbers, debug hooks + headless NL playthrough per
  feature, memory files updated.
- Watch the Custodian-prompt size as verbs land (`begin_combat`, `open_shop`,
  `cast_spell`...) — this roadmap is exactly the growth that triggers the
  **sub-Custodian router** (HANDOFF §10). Re-evaluate after §5 and §6 land.
