# RPG Custodian — Engineering Handoff

_For the next agent (or human) continuing this extension. Read
`game-design/emergent-systems.md` first for the **why**; this doc is the **how**._

Last substantial work: 2026-07-28. Everything below is current as of
`index.js` ~6540 lines. Phases so far: unified effect system + birth/curse/
lorebook/status/equipment/reunion (07-25); romance redesign — reaction judge,
verbose bands, arousal teeth (07-25, `game-design/romance-redesign.md`); world
management — World Manager, map builder, cast wizard, bundles, location
secrecy (07-26/27, `game-design/world-management.md`); imposed/narrative
statuses, cap mods, pins, event_teleport, evidence-only descriptions, GM card
v2.2, **single-card architecture** (07-27/28 — see §0.5).

---

## 0.5 Architecture changes AFTER the sections below were written

These supersede anything contradictory further down; details live in the
memory files (§7) named in brackets.

- **Single-card architecture** [`single-card-architecture`]. RPGC_ card copies
  are RETIRED. The ORIGINAL character card plays in the group; all engine data
  is namespaced in `data.extensions.rpg_custodian` (spec-legal).
  `mergeRpgIntoCard()` → `/api/characters/edit-attribute` is the ONLY write
  path for existing cards — NEVER `/api/characters/create` on an existing card
  (it wipes embedded art; caused two data-loss incidents). Greetings are
  suppressed at CHAT level (fresh-game splice), cards keep their authored
  `first_mes`. Talkativeness normalized to 0 on both spec surfaces (Dyna's
  house rule). `migrateSingleCards()` at init folds legacy copies. Cast +
  GM wear an `RPG-C` tag via ST's tag system (`ensureRpgTag`).
- **The reaction judge** [`romance-reaction-judge`]. Affection moves ONLY via
  a post-reply band-break judge on the NPC's own reply — never via charm
  checks (charm = framing-acceptance, fed as a one-shot interpretation note).
  `adjust_affection`/`adjust_arousal` are lane-narrowed to external/magical
  causes. Arousal: floor 0, decay 2/period, post-coital stamina valve.
  Effective reads `getNpcAffection`/`getNpcArousal` (raw + status mods,
  cap-clamped) feed all bands/displays; raw stays the judge substrate.
- **Statuses grew teeth** [`status-equipment-conditions`,
  `narrative-imposed-statuses`]. Cap mods (`{stat, cap:N}`), affection/arousal
  as moddable stats, narrative-only `mods:[]` statuses, `immobilizes:true` →
  location pins, vows (promises SHE makes) vs objectives (player-only),
  IMPOSED STATES watch-block (things done TO a character), status
  self-notes + aged lifecycle reactions.
- **event_teleport** — story-driven translocation, reaches node-isolated
  locations (pocket dimensions); shares `arriveAt()` with `move`.
- **Prompt-gating doctrine** [`prompt-gating-lesson`]. Never gate WHEN a model
  speaks via prompt text ("stay silent unless…" is useless and harmful) —
  talkativeness/engine triggers are the lever; prompts shape HOW. GM card
  v2.2 is capability-only, self-updates via `GM_CARD_VERSION`.
- **New Game vs Continue**: New Game ALWAYS hard-resets to
  `worldData.startingLocation` and wipes persona `world_state`; resuming is
  Continue's job. Init `await context.getCharacters()` FIRST (cold-load race).
- **Area descriptions** [`area-description-style`]: evidence-only (traces, not
  inhabitant vignettes; no cast names except diegetic props), printed only on
  Look.

---

## 1. Orientation in 60 seconds

- **One file does almost everything:** `index.js`, a single `jQuery(async () =>
  {…})` IIFE. It imports SillyTavern internals by relative path (`../../../…`).
- **Three actors, never blurred** (the load-bearing architectural rule):
  - **Intent Analyzer** — headless `generateRaw` call; reads the player's message
    + live state, emits a JSON intent (check? which stat? effects?). Never
    narrates. `analyzeIntent()`.
  - **Game Master** — a V2 character with talkativeness 0. Only narrates resolved
    actions when the engine invokes it. `narrateResult()`, `sendGameMasterMessage()`.
  - **NPC actors** — real group-chat characters; only the _addressed_ one replies,
    triggered deterministically from the player's words. `detectAddressedNpcs()`,
    `triggerNpcReply()`.
- **The loop:** player message → `onUserMessage` → `orchestratePlayerAction()` →
  `analyzeIntent()` → apply effects (in the Custodian's emitted order) → narrate →
  trigger addressed NPC(s) → **reaction judge** (`judgeNpcReaction`, ±affection/
  arousal from her reply vs her band) → `checkPendingConditions()`. A `generate_interceptor`
  suppresses the group's own auto-reply so only our pipeline speaks.
- **State lives in the player persona:** `power_user.persona_descriptions[avatar]
  .rpg_data` (`getPlayerRpgData()`). Per-NPC dynamic state hangs off
  `rd.relationships[npcName]` (`getRelationship()`), so each NPC only knows her own
  feelings and multiple heroes can share a world. World/session state (location,
  time, party, offspring, roster) is `currentGameState`, persisted to
  `game-worlds/saves/`.

---

## 2. The effect system — the thing you will extend most

Read `emergent-systems.md` §1–§2 for the model. Mechanically:

- **`applyEffects(list)`** is the big `switch` (search `case 'add_status':`). Sync
  effects live here. **Async/world effects** (`move`, `add_party`, `remove_party`,
  `advance_time`, `rest`, `examine`) are applied in `orchestratePlayerAction` **in
  the exact order the Custodian emitted them** — that order is the narrative
  sequence and decides where things land (e.g. carry-her-then-leave vs.
  leave-her-then-go). Do not re-sort them.
- **Unified effects** (`add_status`/`add_objective`) → `customEffects` on player or
  NPC. Read via `customStatMod(stat)` / `npcStatMod(name, stat)`, both folded into
  `effectiveStat` / `npcMaxStamina` / `fertilityPercent` / `ruggednessOf`.
- **Three end-triggers:** `expiresStep` (timer, in `pruneCustomStatuses`),
  `endCondition` (judged, in `checkPendingConditions`), `expiresOnCheck` (spent in
  `consumeCheckEffects` after a stat roll). All in one record.
- **`SELF_NARRATING` set** (in `effectsSummary`): effects that print their own rich
  ghost message and must NOT also appear in the generic `📦` summary line. Add your
  new verb here if it announces itself.

### The recipe: adding a new effect verb

1. **Write the handler** (a function near its siblings) and wire a `case` in
   `applyEffects` — or, if it's async/world-mutating, in the ordered loop in
   `orchestratePlayerAction`.
2. **Teach the Custodian**: add a `{"type":"your_verb", …}` line to the effects
   section of the `analyzeIntent` system prompt. Describe **the category of
   situations** it fires in, not a list of examples — the model generalizes from
   shape, not instances (see emergent-systems §3). State clearly what the engine
   does vs. what the model must not invent.
3. **Add to `SELF_NARRATING`** if it prints its own message.
4. **Surface it** where relevant: status block (`projectPlayerStatus`),
   `examineSelf`, `examineNpc`, character sheet.
5. **Add a debug hook** to `window.rpgCustodianDebug` (bottom of the file) so it's
   testable headlessly without coaxing the LLM.
6. **Persist it** if it's new top-level state: add to the save object in
   `saveCurrentState` and the restore in the load path, and to the `rpg_data`
   init + backfill in `getPlayerRpgData`.
7. **Test headlessly** (§4), including at least one full natural-language run.

**Before building a bespoke subsystem, ask if it's already `add_status` wearing a
hat.** Quests, pacts, diseases, blessings, one-use pre-buffs all are. The bar for
a genuinely new verb is: does it change a _resource/relationship/world fact_ that
no existing verb touches? If it's just "a temporary/conditional stat change with a
flavor," it's a status.

---

## 3. Map of the important functions

| Concern | Functions |
|---|---|
| Player/NPC state | `getPlayerRpgData`, `getRelationship`, `savePlayer`, `saveCurrentState`, `currentGameState` |
| Stats & checks | `baseStat`, `effectiveStat`, `customStatMod`, `npcStatMod`, `equipStatMod`, `skillCheck`, `consumeCheckEffects` |
| Unified effects | `addCustomStatus`, `addObjective`(via `add_objective`), `completeObjective`, `removeCustomStatus`, `pruneCustomStatuses`, `evaluateConditions`, `checkPendingConditions`, `effectIcon`, `statusEndsLabel` |
| Stamina/mana/heal | `maxStamina`, `getStamina`, `spendStamina`, `healStamina`, `restoreEveryoneStamina`, `doRest`, `restoreManaEffect`, `maxMana` |
| Breeding/birth | `resolvePlayerOrgasm`, `advancePregnancies`, `pregnancyStage`, `resolveBirth`, `autoBirthOffscreen`, `hatchEggs`, `offspringFootnote`, `resolveConceptionKind` |
| Curse | `applyCrystalCurse`, `liftCrystalCurse`, `tryApplyCrystalCurse`, `debuffContest`, `pruneCurses`, `isCrystalCursed` |
| Equipment | `appraiseItem`, `queueAppraise`, `toggleOrUseItem`, `setEquipItemByName`, `itemIsConsumable`, `equippedItemsSummary`, `openInventory` |
| Living world | `noteSeen`, `markPresentSeen`, `buildReunionNote`, `recoverUnconscious`, `wakeNpc`, `addToParty`, `removeFromParty`, `triggerNpcDeparture`, `scheduleSummary`, `getNpcsAt` |
| Context to models | `analyzeIntent`, `recentSceneForAnalyzer`, `isStoryMessage`, `statsContextForAnalyzer`, `projectPlayerStatus`, `currentSceneLabel` |
| Lorebook | `ensureRpgLorebook`, `RPG_LORE_ENTRIES` |
| Orchestration | `orchestratePlayerAction`, `onUserMessage`, `narrateResult`, `triggerNpcReply`, `applyEffects`, `effectsSummary` |

---

## 4. Testing — the headless harness

There is a real, working end-to-end test rig. Use it; do not hand-verify.

- **Setup:** a headless Ungoogled Chromium with CDP on `:9222`, pointed at the
  live SillyTavern (`localhost:8000`). Start command is in `test/harness.js`'s
  header comment. The extension is symlinked into the live server, so editing
  `index.js` + hard-refresh (or a fresh page) picks it up.
- **Pattern:** `test/*.js` scripts use puppeteer-core: create character → New Game
  → drive turns. Two ways to drive:
  - **`window.rpgCustodianDebug.act(text)`** runs the full orchestration on a
    string, exactly as if the player typed it — use for **emergent / NL tests**
    (the ones that prove the Custodian _judges_ correctly).
  - **Direct debug hooks** (`buff`, `curse`, `birth`, `addStatus`, `rollCheck`,
    `tick`, `setPreg`, `hurt`, `teleport`, …) set/inspect state deterministically
    — use for **mechanical assertions** that shouldn't depend on the LLM.
- **Model caveat:** the headless test account runs a cheap/flash model. It
  occasionally: answers in Chinese, judges conditions a touch eagerly, or
  hallucinates absent NPCs. **These are test-model artifacts, not code bugs** —
  the pro model (DeepSeek Pro) is far stricter. Design mechanics so correctness
  does not _depend_ on the judge being perfect (timer backstops), and note the
  artifact rather than chasing it.
- **Always run one full NL playthrough** for any Custodian-facing change, not just
  mechanical unit checks — the whole value proposition is emergent behavior, and
  only an NL run exercises the prompt.

---

## 5. Prompt-engineering notes that cost real iterations

- **Teach categories, not examples.** "Anything that lingers past this moment is a
  status" generalizes; a list of five diseases does not.
- **Say what the engine owns.** Every verb's prompt line should tell the model
  _not_ to invent the numbers the engine computes (fertilization results, token
  counts, offspring names, damage the engine rolls). Models will confabulate
  ground truth if you let them.
- **Freshly-applied effects must narrate as taking hold.** The `justCreated` flag +
  the GM `freshNote` exist because arrival-narration was being misjudged as
  resolution. If you add self-ending effects, respect this.
- **Order is meaning.** The Custodian emits effects in narrative order and the
  engine honors it. Don't add a verb that silently reorders a sequence.
- **Lane discipline.** When two verbs could both fire for one situation, the prompt
  must say "pick one, never both" (learned when buff+status double-counted). Fewer
  overlapping verbs is always better — prefer folding over adding.

---

## 6. Known sharp edges / tech debt

- **Single-file size.** `index.js` is ~4400 lines. It's coherent but large; a
  module split (effects / world / breeding / prompts / ui) would help, if done
  carefully — everything relies on shared closure scope and hoisted function
  declarations right now.
- **The Custodian prompt is long and growing.** Every verb adds lines. This is the
  central scaling tension (§10) and the reason the sub-custodian idea exists.
- **NPC-side effects are display-consistent but only partially wired.** NPC
  `customEffects` mods feed `npcStatMod` (fertility/stamina/ruggedness/resist), but
  not every NPC-facing calc consults it — audit if you add NPC-affecting stats.
- **`checkPendingConditions` cost.** One judge call per turn _when conditions are
  pending_. Cheap now; if effects proliferate, consider batching (already one call
  for all pending) or a cheaper model for the judge.
- **Test scripts accumulate.** `test/` has many one-off scripts; they're useful as
  regression seeds but unpruned. `harness.js` is the stable part.
- **`apply_buff` / `active_boosts` are GONE.** If you see them referenced anywhere,
  it's stale — everything is `add_status`. `addBoost` survives only as a thin shim.

---

## 7. Memory / continuity for the AI worker

There is a persistent memory store (see `MEMORY.md` in the agent memory dir) with
one file per system: `status-equipment-conditions`, `birth-system`,
`crystal-curse-lorebook`, `npc-continuity-reunion`, `party-and-time-triggers`,
`romance-breeding-stamina`, `buff-system` (⚠️ marked superseded). These are the
fastest way to reload _what was built and why, plus the exact function names and
verified behaviors_. Update them when you change a system; mark superseded ones
rather than deleting the history.

---

## 8. Design values to preserve

If you internalize nothing else:

1. **Engine owns numbers; Custodian owns judgment; vocabulary is the boundary.**
2. **Reach for the reasoning model for _judgment_, never for arithmetic or recall.**
3. **A missing capability is usually a missing verb, not a prompt failure.**
4. **Fold before you add.** One system doing more beats two that sound alike.
5. **Consequences must echo.** Absence, injury, birth, betrayal — the world should
   remember. That's the line between a sandbox and a scene generator.
6. **Prove it emergently.** If it only works when you spell it out to the
   Custodian, it doesn't work.

---

## 9. Backlog / natural next features

- **Spellcasting proper.** Mana + soul crystals + the curse contest are the seed.
  Spells as Custodian-castable effects (thought-inception, enchantments,
  summons), Mana costs, acquisition (Power Token sink?). The debuff-contest is the
  template for offensive spells; `add_status` is the template for their effects.
- **More curses/debuffs/blessings** now that the contest + condition machinery is
  reusable — enemy casters, traps, cursed items (all already supported via
  `apply_curse` power-proxy).
- **Combat depth** beyond the stamina exchange (initiative, positioning?) — but
  only if it stays inside the effect vocabulary rather than becoming a mode.
- **Power Token sinks** (still open from core-mechanics §13).
- **Guardrail validator** for unbacked mechanical claims in NPC/GM prose (the
  "fake statblock" problem).

---

## 10. The sub-Custodian idea (future — noted by Dyna, deferred)

**The problem it solves:** the effect vocabulary and its prompt guidance grow with
every feature. There is a real ceiling where the single Custodian prompt becomes
too large and diffuse for the model to wield precisely — it starts missing verbs
or misapplying them not from bad judgment but from _overload_. This is the
scaling tension called out in §9 of `emergent-systems.md`.

**The proposed shape:** a two-stage Custodian. A cheap, fast **router / sub-
Custodian** first classifies the player's action into a _domain_ (combat?
social? magic? travel? economy? intimacy?), then the full effect vocabulary is
_filtered down to only the verbs relevant to that domain_ before the main
Custodian call. The main Custodian then reasons over a small, sharp toolset
instead of the entire surface. Think of it as **attention management for the
tool list** — same idea as this codebase's context filtering (`isStoryMessage`),
applied to the vocabulary instead of the scene.

**Why it's deferred, and what to watch for when it's time:**
- Don't build it until the vocabulary is actually big enough to hurt — premature
  routing adds a call and a failure mode for no benefit. The trigger is
  observing the single Custodian _miss or misfire verbs due to breadth_, not
  hypothetically.
- The router must never be a keyword scan (that would betray the whole thesis) —
  it's a small reasoning call, cheap but still judgment.
- Domains will overlap (seducing a merchant is social _and_ economic); the filter
  must _union_ relevant sets, not force a single bucket, or you recreate the
  three-systems confusion at the routing layer.
- Keep the boundary honest: the router decides _which verbs are visible_, never
  _what happens_. The main Custodian still makes the call. Same law as always —
  routing is context management, not authority.

When you build it, write it up here and in memory, and treat it as the natural
continuation of the "spend the reasoning model well" principle that shaped
everything above.
