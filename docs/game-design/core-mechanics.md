# RPG Custodian — Core Mechanics (Canonical)

Distilled from Dyna's notes (`raw-notes-2026-07-23.md`), the Stepped Thinking
prototype, and external research (`inspiration-research.md`). This is the
working spec; open questions are marked ❓. This is an adult-oriented sandbox
game; mechanics are documented matter-of-factly.

> **📎 See also — the systems built on top of this spec:**
> - **`emergent-systems.md`** — the unified effect system, the task-satisfied
>   condition judge, bespoke Custodian-invented statuses, equipment appraisal,
>   birth/breeding, the living-world/reunion machinery, magic seed layer, and the
>   design philosophy behind all of it. Read it for how the game actually plays as
>   of 2026-07-25.
> - **`../HANDOFF.md`** — engineering handoff: architecture map, the recipe for
>   adding an effect verb, the headless test method, known sharp edges, and the
>   future sub-Custodian plan.
>
> Where this doc and those disagree, those are newer. Several ❓ below are now
> resolved there (equipment, spells seed, party/reunion, breeding→birth).

## 1. Design philosophy

- **The engine owns the numbers.** Every stat, roll, resource, and clock lives
  in extension-managed state. The LLM never does arithmetic and never recalls
  a value from chat history. (The Stepped Thinking prototype proved why:
  LLM-accounted values drift non-sensically.)
- **Three separate subsystems, not one smart GM** (locked 2026-07-23). Intent
  detection, narration, and character acting are handled by *different* actors:
  - **Intent Analyzer** — a separate subsystem that makes its own secondary API
    calls (the way the Expressions extension does sentiment analysis), reads
    each player input for intent to perform a game action, and drives the
    engine. It logs its results to the chat as **system messages**. This is NOT
    the GM chatbot — it is headless analysis.
  - **Game Master** — a pure narration engine. Its character has
    **talkativeness 0**, so it never auto-speaks; it is invoked only (a) by an
    engine/function call to translate a resolved action into flavorful
    narration, or (b) by an explicit @mention. Its visible role is limited to
    game actions and their flavor: waiting, moving, spellcasting, skill-check
    outcomes, narrated player actions.
  - **NPC actors** — real V2 characters in the group chat; only the *addressed*
    NPC responds (see §11). They speak for themselves from their cards.
- **Free-form first.** The player just roleplays. The Intent Analyzer translates
  free-form action into mechanics; the engine executes and logs; the GM is
  invoked to narrate. Inline buttons cover simple verbs (talk, move, shop, wait,
  rest). Slash commands remain only as manual fallbacks and debug tools.
- **Stats reach the LLM as natural language, generated programmatically.**
  Numbers are projected through tier tables into sentences (see §8), so
  presentation is consistent and the model gets meaning, not just digits.

## 2. Terminology & storage map

SillyTavern vocabulary matters because save data piggybacks on it:

| Term | Means | RPG Custodian use | Where RPG data lives |
|---|---|---|---|
| **Persona** | The player's character (User Persona system) | The MC | `power_user.persona_descriptions[avatar].rpg_data` (extended persona, already prototyped via `initRPGPersona()`) |
| **Character** | A V2 character card (an NPC) | NPCs / romanceable cast | Card `extensions` field (invisible to LLM) and/or `creator_notes`; per-save dynamic state in the save file keyed by character |
| **World** | — (our concept) | Static world template | `game-worlds/fresh-worlds/<id>/` |
| **Save** | — (our concept) | All dynamic state | `game-worlds/saves/<world>_<slot>.json` |

Rule of thumb from save-system research: static/template data (world layout,
card definitions, base stats) never goes in saves; all dynamic state (current
values, flags, clocks, relationships) always does. NPC dynamic stats belong to
the **save**, not the card — cards are shareable cartridges.

## 3. Player stats

Four primary stats (fifth slot ❓ open — candidates welcome):

| Stat | Governs | Derived resource |
|---|---|---|
| **Ruggedness** | Strength/endurance tests; physical checks | **Stamina** — the HP pool; also finishes: can climax once per point per encounter; spent on exertion, item hauling, leveling costs |
| **Charm** | Likeability/attractiveness; contested social checks when an NPC is untrusting or resistant; **always rolled when escalating a sexual encounter** | — |
| **Craftiness** | Magic use, problem solving, plan making, reading true intentions / detecting lies | **Mana** — daily pool spent on spells |
| **Virility** | Fertilization multiplier; the reward-multiplier stat tied to the core progression loop | Extra fertilization rolls (see §6) |

Notes:
- Stamina doubles as HP and as a spendable resource (spells, purchases,
  level-ups per raw notes ❓ — confirm whether gold and stamina are both
  currencies or whether stamina-for-purchases was exploratory).
- Player state also includes: inventory, gold, location, party list, spell
  list, XP, level, fertility(❓ vs Virility — may be the same axis), and the
  time/date the engine tracks globally.

## 4. Skill checks — calibrated 2d6 + stat vs DC (tuned 2026-07-23)

**Roll 2d6 + the character's stat vs a difficulty (DC).** Grounded in the two
best-understood 2d6 systems (Traveller's task ladder; PbtA's 2d6+stat curve):
2d6 is a tight bell curve centered on 7, so the *stat dominates* and small DC
shifts near the center swing the odds ~11-14% each. Design consequences:

- **Stat scale (the stat is the die modifier):** 1-2 feeble, **3 = average
  novice / starting adventurer**, 4-5 capable, 6-7 skilled, 8-9 exceptional,
  10+ legendary. Stats grow slowly; a +1 is meaningful.
- **Difficulty ladder (absolute task difficulty, not relative to the PC):**
  Easy 8, Moderate 10, Hard 12, Very Hard 14, Legendary 16, Near-impossible 18.
  Success chance for a novice (stat 3): Easy 83%, Moderate 58%, Hard 28%, Very
  Hard 8%, Legendary ~0%. Growth is real scaling — at stat 6, Hard→72%, Very
  Hard→42%, Legendary→17%.
- **Boosts/modifiers stay small** because of the tight curve: a legendary potion
  is **+3** (shifts ~1.5 bands), common consumables +1 to +2. The earlier +8
  potion was a demo hack that flattened all drama — corrected.
- **Only roll when it's uncertain AND dramatic** (§11 GM judgment). Rule of
  thumb baked into the analyzer: roll when (DC − stat) is ~5-11 (≈15-85%).
  Engine safety net: if (DC − stat) ≤ 2 the PC *cannot* fail (min 2d6 clears
  it) → auto-succeed, no theatrical roll.
- **Four outcome tiers:** total ≥ DC+4 critical · ≥ DC success · ≥ DC-3 mixed
  ("yes, but…") · else failure.
- **Emergent XP:** difficulty-scaled on success (harder feats worth more) —
  besting a dragon ≫ finding a stick. (The §5 sexual-encounter XP is the other,
  larger track.)

Research: Traveller targets 8 for "average" (41% at +0), each +1 near center
≈ +11-14%; PbtA +3 already exceeds 90%. Sources logged in
`inspiration-research.md` intent.

The analyzer paraphrases the player's *intent* shaded by the outcome and never
treats the typed action as automatically canon (Crunchatize's agency-transfer
insight): the GM narrates what actually happened per the roll.

## 5. XP, levels, Power Tokens

- **XP source: sexual encounters**, scaled by difficulty/danger — "Bard
  experience." A conquest that required real risk, wooing, or a hostile start
  (the cranky dragon) is worth far more than an easy lay (the village girl).
  The GM assesses encounter difficulty via tool call; engine applies a bounded
  XP table so values can't inflate.
- Failures and crits on skill checks trickle small XP (§4).
- **Leveling** raises a chosen (or most-used ❓) primary stat.
- **Power Tokens — the macro-progression currency: one birth = one token.**
  Carrying pregnancies to term is the long-arc goal; tokens buy ❓ (spell
  unlocks? stat caps? world perks? — to be designed).
- Alternate play styles (config per world/save): normal pregnancies,
  super-speed pregnancies (the Stepped Thinking prototype's "overnight"
  pacing), or reflavored output — eggs, magic crystals — same mechanics,
  different skin.

## 5b. Stamina, sex & combat — the unified HP system (locked 2026-07-24)

**Stamina is the single HP pool for BOTH combat and sex.** One resource; a
berserker and a marathon lover draw from the same well.
- **Max Stamina scales with Ruggedness** (current impl: max = effective
  Ruggedness). Current stamina is spent and restored.
- **−1 Stamina per orgasm** (PC or NPC). **−damage per combat hit.**
- **Stamina 0 → unconscious.** Rest/sleep restores to max (and clears
  unconsciousness).
- Example: Ruggedness 3 → 3 Stamina → can climax ~2 times and stay conscious
  (the 3rd zeroes you out). Same pool means the same "one more?" tension in a
  fight or a bed.

**Propositions = Charm checks.** Any advance/proposition to an NPC (a kiss, a
night together, escalating an encounter) is a Charm check; the DC scales with
the boldness of the ask and is **lowered by her affection** (a Smitten NPC
barely resists; a Wary one needs real convincing). Consent/escalation flows
from the check.

**Relationships live in the PLAYER'S persona** (hidden `rpg_data.relationships`
keyed by NPC name): affection (0–10), arousal, familiarity, pregnancies,
progress. So each NPC only "knows" her own feelings (projected per-present-NPC),
and multiple player characters can inhabit one living world with independent
relationships.

**Affection 0–10 ladder** (d6-friendly): 0 Wary · 1–2 Cordial · 3–4 Warming ·
5–6 Fond · 7–8 Smitten · 9 Devoted · 10 Adoring. Projected as behavioral cues.

## 6. Fertilization / breeding math (locked 2026-07-24)

**An internal male orgasm (P-in-V, finishing inside) rolls fertilization
VIRILITY times, each independent roll at the woman's Fertility%.** Virility =
number of shots on goal per climax; each success = one fertilization. So a
single climax can take multiple times → twins/triplets. Multiple orgasms (capped
by Stamina) add more rolls still.
- **Fertility%** is a per-NPC base depending on race/age (card field
  `rpg_custodian.fertility`), modifiable by potions/spells/equipment/cycle.
- Example (Fertility 50%, Virility 3): 3 rolls at 50% per climax. P(all 3) =
  0.5³ = **12.5%** chance of triplets from ONE orgasm (1 Stamina). Ruggedness 3
  → 3 orgasms possible → up to **9 rolls**, so up to 9 fertilizations in an
  encounter (vanishingly unlikely, but possible). Expected count per climax =
  Virility × Fertility.
- Raising Virility (level-ups, gear, spells) or her Fertility% (potions, fertile
  cycle) is the core breeding progression lever.
- Pregnancies accumulate on the (player, NPC) relationship record; progress
  advances with game time (stages per §7 / Stepped Thinking bands). One birth =
  one Power Token (§5).

### Older analysis (superseded by the Virility×Fertility% rule above)

Per raw notes: base fertilization chance per climax inside, with **one
independent roll per point of Virility**.

Correct "at least one" formula: `P = 1 − (1 − p)^V`. The raw notes' example
(20% × 3 → "1.2³ = 72.8%") used a compounding formula that doesn't yield a
probability; actual values at p = 20%:

| Virility | ≥1 fertilization | Expected count |
|---|---|---|
| 1 | 20.0% | 0.20 |
| 2 | 36.0% | 0.40 |
| 3 | 48.8% | 0.60 |
| 4 | 59.0% | 0.80 |
| 5 | 67.2% | 1.00 |

If ~73% at Virility 3 is the intended *feel*, raise base p to ~35%
(1 − 0.65³ = 72.5%). ❓ Tune p during playtesting; multiple fertilizations
from one event are possible and intended (each successful roll = one
pregnancy, matching the prototype's "3 fertilizations!" flavor).

Fertility may also exist NPC-side (cycle state as a modifier on p — the
prototype's "currently ovulating" beat) ❓.

## 7. NPC stats

Per-NPC dynamic state (stored in the save, keyed by character):

| Stat | Range | Notes |
|---|---|---|
| `location` | world location id | Drives presence + schedules |
| `familiarity` | counter | Increments with repeated interaction across distinct days; gates re-encounter priming depth and relationship tier |
| `affection` | 0–100%+ (can exceed 100 per the "110%" example) | The romance meter; tiered descriptions (§8) |
| `arousal` | 1–10 | Scene-scoped; 10 forces climax then resets to 1; decays slowly; effectively capped below 10 outside sex (prototype rules) |
| `in_party` | bool | §9 |
| `pregnancies` | count | Simultaneous pregnancies from one or more events |
| `pregnancy_progress` | 0–120% | Always increasing with time; stage bands below |
| schedule | per-time-period location table | Static per character (card `extensions`), position dynamic |

**Pregnancy stages** (inherited verbatim from the Stepped Thinking prototype):
Zygote 5–9% → Womb Implantation 10–24% → Fetal 25–34% → 1st Trimester 35–59%
→ 2nd Trimester 60–79% → 3rd Trimester 80–99% → Birth Overdue 100–120%.
Progress ticks with game time (rate set by play style, §5). At birth: +1 Power
Token, pregnancy resolves, world state records the child ❓ (children as
world-state flavor? nursery mechanic? — later).

**All NPCs are romanceable.** No hardcoded exceptions; every RPG-C character
gets the full stat block. Cast is all female.

## 8. Natural-language stat projection

The engine renders stats into prompt-injected natural language via macro
templates + tier tables — the prototype's format, now with honest numbers:

```
{{char}}'s current affection value towards {{user}} is {{affVal}}, which means {{affValDesc}}.
{{char}}'s current pregnancy status is: {{isPreg}}, with {{pregNum}} {{pregStage}}. This means that {{char}} {{pregDesc}}.
```

- Every projected line follows the shape: **value → tier label → behavioral
  meaning** ("8/10 — Loved and Trusted — she trusts him unconditionally…").
  The behavioral clause is instruction, not decoration: it tells the model how
  to play the character at that tier.
- Tier tables live in data (per-stat JSON), not code, so they're tunable and
  world-authorable. Seed the affection and arousal tier text from the
  prototype prompt (e.g. low affection ⇒ "scrutinizes every action as a
  potential ploy"; arousal tiers up through "Hot and Bothered", "Imminent
  Orgasm", "Currently Orgasming").
- Injection is refreshed programmatically every generation (author's note /
  depth injection), so current values are always in context and stale ones
  never are.
- Stat *changes* since last message can also be surfaced as a system line
  ("+2 Affection!") for game feel ❓ toggleable.

## 9. Presence, party, schedules, and re-encounter priming

- **Presence on stage:** the engine adds/enables group members whose
  `location` matches the player's (per current time period), disables the
  rest. The **SillyTavern-Presence** extension then keeps each character's
  context limited to what she actually witnessed. Engine = who's on stage;
  Presence = who saw what; card = who she is.
- **Party system:** `in_party` NPCs travel with the player — their location
  auto-follows, they stay enabled across moves, and they witness everything
  (Presence handles that naturally). Party size cap ❓.
- **Schedules:** each NPC card declares a simple time-period → location table;
  the engine moves NPCs on every time advance. Off-screen NPCs exist only as
  state — no LLM calls.
- **Re-encounter priming:** when an NPC re-enters the scene after time has
  passed, the engine injects a fresh briefing so she doesn't resume the old
  scene as if no time passed. Programmatically composed from state:
  1. How she knows {{user}} and their relationship tier (familiarity +
     affection projection),
  2. How much game time since last meeting,
  3. What she's been up to meanwhile (schedule-derived + optional one-shot
     LLM "gap summary" generated at reunion time ❓),
  4. Her current condition (pregnancy stage advancing during absence, etc.).

## 10. Tags (SillyTavern tag system as lightweight metadata)

- `RPG-C` — marks a card as RPG Custodian-compatible (properly formatted
  `extensions` data). The extension only manages tagged characters.
- `Merchant` — enables the inline shop menu when present (§11).
- `world:<id>` (e.g. `world:prototype-town`) — which world(s) the character
  belongs to; used to build the world's cast list on load.

## 11. Interaction model

An RPG session is a **group chat** (Game Master + the world cast). Membership is
static; *presence* is controlled by muting — the engine keeps every NPC not
currently at the player's location in the group's `disabled_members`, and
un-mutes exactly those whose schedule places them here-and-now (§9). Presence
extension then limits each NPC's memory to what she witnessed.

**Turn-taking — only the addressed NPC responds** (locked 2026-07-23). When the
player writes, exactly one NPC replies: the one they address. No unsolicited
chime-ins from other present NPCs. Present-but-unaddressed NPCs stay silent
until spoken to. Mechanism: NPC talkativeness kept low; the Intent Analyzer
(below) resolves *who* is addressed and triggers that specific character
(force-talk / manual activation). The Game Master has **talkativeness 0** and is
never part of natural turn-taking.

**The Analyzer judges like a GM, not a rules lawyer** (locked 2026-07-23). It
decides not merely *whether an action touches a stat* but *whether a roll would
generate interesting drama* — exactly the call a skilled human GM makes. A check
is warranted only when the outcome is genuinely uncertain, the stakes are real,
AND both success and failure would be dramatically interesting. Trivial actions,
foregone conclusions, and moments where failure would be boring/anticlimactic
get NO roll — the engine just applies the effect and narrates. This judgment
lives in the Analyzer's system prompt, fed the recent scene as context so it can
weigh drama, not just difficulty. (Rolling for a dull action is as much a
mistake as skipping a roll on a tense one.)

**The intent pipeline** (per player input):
1. **Intent Analyzer** — separate subsystem, own secondary API call(s) à la the
   Expressions extension. Judges the input with GM sensibility (above),
   classifies game-action intent (skill-check-worthy action, item/gold change,
   who is addressed, etc.), and emits the result as a **system message** in
   chat. Does not narrate.
2. **Engine** — executes the resolved action deterministically (rolls, stat
   changes, time, presence), logs ground truth.
3. **Game Master** — invoked by the engine (function call) *or* an @mention to
   translate the resolved action into flavorful narration: waiting, moving,
   spellcasting, skill-check success/failure, narrated player actions. Nothing
   else. It never decides mechanics and never speaks unprompted.

Engine action surface the analyzer/engine drive (formerly framed as "GM tool
calls"): `skill_check`, `award_xp`, `adjust_gold`, `adjust_affection`,
`adjust_arousal`, `advance_time`, `move_player`, `modify_inventory`,
`resolve_climax` (stamina spend + fertilization rolls), `open_shop`.

Secondary surfaces:
- **Inline buttons** (simple verbs): talk / move / shop / wait / rest, rendered
  unobtrusively in the chat stream; merchant inventories render as inline menus.
- **Slash commands** (fallback/debug only): keep the `/rpg-*` set working but
  treat as developer tools, not the player interface.
- **RPG menu** (button → dropdown): New Game / Continue / Create Character /
  Character Sheet / Wait / Date / Exit. Create Character added 2026-07-23.

Design note: whether the engine action surface is implemented as ST function
tools called by a model, or as direct calls the Intent Analyzer makes after its
own classification, is an implementation detail — but the *decision* to act is
the Analyzer's, never the GM narrator's. Programmatic guardrail ❓: a
post-response validator that detects mechanical claims with no matching engine
action (the "fake statblock" problem Crunchatize had to trim).

## 12. Equipment & spells

> **✅ Partially built — see `emergent-systems.md` §4 (equipment) and §7 (magic
> seed). Below is the original design space; the implemented shape differs where
> noted.**

- **Equipment** — _implemented_: items carry a **Custodian-appraised** effect
  (shown beside the name) + a structured modifier; flat bonuses fold into stats,
  contextual ones ("+1 Craftiness in nature") are surfaced to the Custodian for
  the DC. Click-to-equip/use in the inventory; NL equip via `equip_item`. No
  fixed slots — the item list is the menu.
- **Spells** cost Mana (Craftiness pool). _Seed built_: Mana + `restore_mana`,
  soul crystals as +1-Mana fuel, and the Crystal Curse + debuff-contest as the
  template for offensive magic. Flagship idea —
  **Thought Inception**: sets the target character's internal monologue via a
  one-reply author's-note injection; max text length scales with spell power.
  Greater version writes into the character card itself (persistent
  suggestion) — mechanically potent and trivially engine-implementable since
  both are just injections. Spell list, acquisition (Power Tokens? ❓), and
  more spells TBD.

## 13. Open questions

- Fifth primary stat — keep at four, or add? (Perception? Fortune, à la
  Crunchatize's Luck?)
- Power Token sinks (what do they buy?).
- Stamina as universal currency vs gold-for-goods split.
- Fertility as separate NPC-side cycle mechanic.
- Party size cap; can party members' schedules "pause"?
- Children as world-state after birth.
- Guardrail validator for unbacked mechanical claims.
- Which model handles tool calls best in ST group-chat contexts (DeepSeek Pro
  primary; test).
