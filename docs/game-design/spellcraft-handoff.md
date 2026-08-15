# Spellcraft — Engineering Handoff

_State of the spell system effort as of 2026-08-14, written for the next
context. Read `spell-ideas.md` (pass 1) and `spellcraft-levers.md` (pass 2)
alongside this; general engine handoff is `docs/HANDOFF.md`._

## The plan of record (Dyna's, three passes)

1. **`spell-ideas.md`** — the idea pile: ~130 spells, 18 schools, fiction only.
   DONE and still open for additions. Contains Dyna's spells (Skybolt,
   Unbridled, Self-Conception, The Borrowed Stag née Futa Hex, Cold Water ⭐,
   Tantric Siphon ⭐) and an accumulating **pass-2 mechanical notes** section
   (Whisper of the Walls via schedules; the mind-reading step; Forget-Me via
   presence arrays; disguise persona surgery; THE ILLUSION DOCTRINE — Dyna
   verbatim: *"character narration is the thread of reality"*; Self-Conception
   & Borrowed Stag levers).
2. **`spellcraft-levers.md`** — the levers write-up: ~40 levers in 9 families,
   each marked EXISTS or NEW(S/M/L); a proposed cut/merge list; an economy
   strawman. WRITTEN, **NOT YET RATIFIED by Dyna** — pitched, awaiting the
   argument. The Hell's Gate worked example (14 mana = ritual 6 + plane 6 +
   2 passengers; soulgems +3 each toward one cast) is the pricing sensibility
   test.
3. **The Spell Artisan** — a forge-family LLM role: colorful natural language
   in → formulaic spell record out. Taught by **instructions, restrictions,
   and rulesets — NEVER examples to reach for** (Dyna, emphatically). Success
   test: it can recreate every spell in the idea doc from its description
   alone. NOT STARTED.

## What is already BUILT and live

- **Action Mode** (memory: `action-mode`) — menu-declared intent; arming is
  one-shot; the freeform analyzer is bypassed on an armed message; the Action
  Mode Judge supplies target + ±2-clamped DC nudge + narration hint.
  **Spellcasting exists ONLY here** — never from prose. This is the
  sub-Custodian scaling fix done with UI; hold that line.
- **`SPELL_CATALOG`** (data, like PRESET_STATUSES) + `knownSpells()`
  (`rd.spells`, prototype-seeded `['summon_lover']` — real acquisition comes
  later). **Summon Lover** is live end-to-end: 4 mana, menu rows per known
  woman, ⛔-gated arming, fizzles spend nothing (mana short / present /
  unconscious), the reverse escort-pin, affection-banded arrival note
  (`summonArrivalNote`), one GM arrival beat, her reply. `castSummonLover`
  is **hardcoded** — generalizing it into a payload-walking `castSpell(record)`
  is a core buildout task.
- **Mana**: pool = Craftiness (`maxMana`), `doRest` refills to full, soulgem
  crush restores (existing), `restoreMana(n)`, debug `setMana`.
- **Adversarial contest frame**: red-tinted rolls (`sendGhostMessage(text,
  {adversarial:true})`), player-win XP by unlikelihood everywhere
  (contest-xp-test), the debuffContest template for offensive casting.
- **Precedents every spell build will reuse**: per-NPC one-shot notes (secret
  area notes machinery), affection-banded reaction notes, engine-truth reads
  in grounded language (cycle awareness style), the reply-judge as the organ
  for HER actions, the player interlude pattern (swan song / Self-Conception
  will extend it).

## Laws that bind the Artisan (all hard-won; do not relitigate casually)

- **Engine owns numbers.** The Artisan picks levers and writes flavor; tier
  tables price cost and magnitude. It can never invent a 9-damage cantrip.
- **Spells never output XP or Power Tokens.** Magic doesn't mint progression.
- **Her dice are hers** (HANDOFF §8 #7). NPC-action spells are judged from
  her own replies (reply-judge pattern — see milking detection), never from
  player prose.
- **Words leak.** NPC-facing narration text uses in-world vocabulary only —
  no game terms, no register meta-instructions (the full-moon and
  "speaks-as-a-woman" incidents). Player-facing ghost lines may be mechanical.
- **The illusion doctrine.** Safe class (ambience/decoration) may ship;
  reality-forking illusions wait for the containment kit (judge-exclusion +
  restoration seed + scoped GM frame). Do not gate the school on the hard
  half.
- **Status laws** (spells mostly ARE statuses): `justCreated` sheds after one
  turn (freshnote fix); removing an ENGINE-DERIVED status must move the
  numbers (revival fix); refresh-don't-stack for repeatable debuffs (Milked
  Dry pattern); grounded language in every her-facing status desc.

## OPEN questions for Dyna before/at buildout

1. Ratify or amend the **economy strawman** (tiers 1/2/4/6; subtle +1,
   imperceptible +2; range rings, plane +6; +1/passenger; permanence = Power
   Token; contested = full price win-or-lose ← *least certain call*).
2. Ratify the **cut/merge list** (arousal auras → one spell; greater-X → tier
   axis; Frostbite→Winter's Grip; Lantern→Sleep; Witchlock→Hearth Ward; cut
   Bloodhound, Name on Wind, Twin Star, Dowsing; pure-narrative class at flat 1).
3. **Borrowed Stag name** (candidates listed in chat: Stag's Loan, Hers to
   Wield, The Lady's Lance, Sire by Proxy…).
4. Starter catalog contents (~10 authored spells, one per school, before the
   Artisan exists).

## Build order (proposed)

1. **Ratify** economy + cuts (one conversation).
2. **Spell record schema + `castSpell(record)`** — generalize from
   castSummonLover: walk a payload of lever-ops; visibility routes narration
   (H1 GM beat / H2 per-NPC note / silent); preconditions checked at arm AND
   cast; fuel (mana, token, soulgem) spent atomically after all fizzle gates.
   Draft record shape (argue at build time):
   `{ id, name, school, tier, cost, visibility, range, targets, contested,
   preconditions[], fuel{tokens,soulgems}, payload[{lever, args}],
   narration{cast, target_note, observer_note}, tags[] }`
3. **Small lever gaps** (all S): cycle shift (`rel.cycleOffset`), pregnancy
   surgery (progress set/freeze/kind), secrecy reveal, schedule history walk,
   teleport passengers, forced reroll.
4. **Starter catalog** authored as data; every spell exercised via Action
   Mode headlessly (forced bounds; ±3 swing margins; cheap-model artifacts
   are noted, not chased).
5. **The Spell Artisan** — forge-family call (see `forgeBespokeStatus` for
   the shape and preset-awareness precedent): input = theme + tier + desired
   effect; output constrained to the lever menu; engine prices from tier;
   saved to `rd.spells` as a full record (spellbook = records, not ids, for
   bespoke spells). Prompt = rules only. Test = recreate N idea-doc spells
   from their fiction and diff the mechanical intent by hand.
6. **Acquisition**: forge costs (gold + downtime + token at high tiers),
   tomes via appraiser, teaching gated on affection band + quest, soulgem
   fuel economy.
7. **M levers as spells demand them**: event-charged wards, conjured
   locations (Pocket Parlor), witness surgery (Forget-Me), persona rewrite
   (Masque), player interlude (Self-Conception).
8. **The two L organs LAST**: mind reading (G7 — the Artisan gets it as a
   rule-governed tool), illusion containment kit (H7).

## Testing notes specific to magic

- Pattern: forced-outcome bounds must absorb the ±3 doubles swing AND the
  judge's ±2 nudge (effective 0 vs DC≥16-style margins).
- `armSummon`/`armRomance`/`armed`/`disarm`/`setMana`/`spells` debug hooks
  exist; add one per new lever (recipe step 5).
- New verbs → Verb Dictionary entry or the drift test fails (recipe step 6);
  spells themselves are NOT dictionary verbs (the Magic section stays
  generic) — levers with new `case` labels ARE.
- The test backend occasionally refuses spicy generations (KO+sex framing) —
  mechanics verify headlessly, prose verifies in Dyna's live play.

## File/function map

`docs/game-design/spell-ideas.md` · `docs/game-design/spellcraft-levers.md` ·
Action Mode section in `index.js` (search `ACTION MODE —`): `SPELL_CATALOG`,
`knownSpells`, `armAction/disarmAction`, `openActionModeMenu/openSpellMenu`,
`actionModeJudge`, `runArmedAction`, `castSummonLover`, `summonArrivalNote` ·
mana: `maxMana/restoreMana/doRest` · contest frame: `debuffContest`,
`skillCheck`, `awardCheckXp`, `successChance` · status machinery:
`addCustomStatus` + presets + `resolvePresetStatus` · her-verbs organ:
`requestReactionVerdict`/`applyReactionVerdict` · tests: `action-mode-test.js`
(28), plus the contest/status suites the spell work must not break.
