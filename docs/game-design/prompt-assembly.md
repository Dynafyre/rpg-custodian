# Situational Custodian Prompt Assembly — plan

_Drafted 2026-07-30. Status: **DEFERRED by Dyna, deliberately.** Nothing
implemented. Keep for when the trigger below actually fires._

## WHEN to do this (decided 2026-07-30)

**Not now.** Dyna's verdict after heavy play: _"The Custodian has been rocking
everything I throw at it… mostly it hasn't missed a beat."_ HANDOFF §10's own
trigger — observing the Custodian **miss or misfire verbs because of breadth** —
is NOT met. The one wobble he reported (multi-action sequencing) turned out to
be an engine bug in the NPC-reply stage, not Custodian confusion. Adding gating
today would buy tokens we do not need at the price of a silent-regression class
we do not have.

**Do it immediately BEFORE the next big system** (spellcasting / combat /
economy), and in two halves:

1. **The restructure, which is the expensive part.** The prompt is a single
   ~31k-char template literal; the real work is turning it into a REGISTRY of
   entries that can carry metadata (including a relevance predicate). This has a
   hard safety proof available: assert the assembled string is **byte-identical**
   to the current one. If it matches exactly, behaviour is unchanged by
   construction and only extensibility has moved.
2. **The gating itself is then a one-line filter**, switched on only when a real
   misfire appears.

Doing the restructure just before the next system means combat's and
spellcasting's verbs are BORN declaring their own relevance, instead of being
retrofitted. Doing it later means retrofitting 40+ verbs instead of 28; doing it
now means designing predicates against three systems that do not exist yet, and
guessing their shape wrong.

**Explicitly rejected:** designing the predicates for unbuilt systems in advance.

---


## 0. The problem, measured

The analyzer prompt is **one static template sent in full on every turn**:

| | |
|---|---|
| size | 30,848 chars ≈ **7,700 tokens** |
| verbs taught | **28**, every call |
| conditional clauses the model must evaluate itself | **19** |
| code-side conditional assembly | **0** |

On a turn where the player is alone in a forest, the Custodian still reads the
Crystal Curse contest rules, birth detection, merchant purchasing, proposition
and consent logic, and companion triggers. Those are not judgement calls — the
engine already knows the answers.

The GM narrator is the shape we want: a **180-token static system prompt** plus
exactly one tier instruction and at most one luck instruction, both chosen by
code (`TIER_NOTE[check.tier]`, `swingNote`). The model never evaluates a branch
the engine could have resolved.

## 1. The danger, stated plainly

**A wrong predicate silently deletes a game mechanic.** There is no error, no
warning — the Custodian simply stops being able to do a thing, and we would
likely discover it weeks later as "the game feels flatter". This is strictly
more dangerous than the token cost it fixes, so the plan is built around
catching that, not around maximising the cut.

Three specific traps:

1. **State that lags the fiction.** Presence is computed *before* the player's
   message is analysed. "I follow her into the back room and shut the door"
   changes who is present — gating on pre-turn presence can drop the verbs the
   turn itself needs.
2. **Verbs that create the state they would be gated on.** `add_party` is only
   relevant when there is no party yet; `apply_curse` matters precisely when
   nobody is cursed. Gating these on "is there a curse/party" is exactly
   backwards.
3. **Stub features.** A verb can have a live handler while the feature behind
   it is unbuilt — `buy_item` dispatches to an 8-line `buyItemByName`, but the
   merchant/shop system of TODO §6 does not exist yet. Gating it on "a merchant
   is present" gates on a concept the world cannot yet express.

## 2. Design rules

- **Fail open.** Any predicate that throws, or any state we cannot read, keeps
  the section IN. A slightly fat prompt is a non-event; a missing mechanic is a
  silent regression.
- **Gate on impossibility, never on unlikeliness.** A section may be dropped
  only when the verb *could not be applied* this turn — no valid target exists.
  "Probably not needed" is not a reason.
- **The core is never gated.** Movement, examine, time, items/gold, statuses,
  objectives and the whole DIFFICULTY block ship on every turn regardless.
- **One predicate per section, written next to the text it gates**, so the
  reason a thing is present is readable in one place.
- **Every predicate is pure and synchronous** over `currentGameState` +
  `getPlayerRpgData()` — no I/O, no LLM, no guessing at intent.

## 3. Proposed gates (for review — nothing is settled)

Risk is the cost of getting the predicate wrong, not the likelihood.

| # | Section / verbs | Proposed predicate | Est. saving | Risk |
|---|---|---|---|---|
| A | `birth` + birth guidance | any NPC with `pregnancies > 0` **anywhere** (not just present) | ~400 tok | LOW — birth needs a carrying mother; no mother, no birth |
| B | Crystal Curse block (`apply_curse`, `lift_curse`, contest rules) | player has mana/craftiness ≥1 **or** anyone is cursed **or** a curse-capable item is held | ~700 tok | **HIGH** — an NPC or trap can curse the player unprompted; see §5 Q2 |
| C | `buy_item` + merchant lines | a present NPC has a `shop` category | ~150 tok | MED — depends on a stub feature (TODO §6) |
| D | proposition / consent / charm-lane rules | at least one NPC present | ~600 tok | **HIGH** — trap 1; needs the post-move recheck of §4 |
| E | `adjust_affection`, `adjust_arousal`, `orgasm` | at least one NPC present | ~350 tok | **HIGH** — same |
| F | `add_party` / `remove_party` | `add` if an NPC is present; `remove` if the party is non-empty | ~200 tok | MED — trap 2 |
| G | `whereabouts` | at least one NPC present | ~120 tok | LOW |
| H | `restore_mana` | world has magic (any spell/mana source) — **needs a real signal, we have none** | ~120 tok | MED — defer |
| I | equipment lines (`equip_item`/`unequip_item`) | inventory non-empty | ~150 tok | LOW |
| J | IMPOSED STATES watch-block | at least one NPC present | ~250 tok | MED |

Rough total if all land: **~3,000 tokens (~40%)**. Realistically we should
expect half that, because the high-risk ones may not survive review.

## 4. The presence problem (trap 1) — proposed answer

Presence is read before the action is understood, so a turn that *moves* the
player invalidates it. Options, cheapest first:

1. **Location-scoped union, not point-in-time presence.** Gate on "is there any
   NPC the player could plausibly reach this turn" — present here, in the party,
   or at an adjacent location. Costs nothing, removes most of the risk, and
   still drops the social block for a genuinely empty wilderness.
2. **Never gate social on presence at all** — only gate the *narrow* social
   verbs (E, G) and keep the proposition rules always-on. Smaller win, near-zero
   risk.
3. Re-analyse after a move (a second LLM call). Rejected: doubles latency for a
   rare case.

Recommendation: **option 1**, with option 2 as the fallback if review shows
option 1 is still too clever.

## 5. Open questions for Dyna

1. **Which verbs do you consider stubs?** My read: `buy_item` (no shop system),
   and possibly `restore_mana` (mana exists, but no spell system yet, TODO §7).
   Stubs might be better *removed from the prompt entirely* until their feature
   lands, rather than gated — that is a content decision, not an engineering one.
2. **Can an NPC or trap curse the player with no NPC present?** If yes, gate B
   must be much looser (or dropped). This is the single riskiest predicate.
3. **Is a 40% cut worth any silent-regression risk at all**, or would you rather
   take a safe 20% (only the LOW-risk gates A, G, I) and stop?

## 6. Method — how we avoid shipping a silent regression

Staged, with your review between each stage. No stage begins until the previous
one is signed off.

**Stage 0 — visibility, before any trimming.**
A debug hook that renders, for the current state, exactly which sections are IN,
which are OUT, and the predicate that decided each, plus the token count. Ship
this *first* and leave it in permanently: it makes the assembly auditable
forever, and it is how you review stages 1-3 without reading diffs.

**Stage 1 — the safe three (A, G, I).** LOW risk only. Measure. You review the
debug view across a handful of real save states.

**Stage 2 — the medium set (C, F, J).** Only after stage 1 has survived a
playtest.

**Stage 3 — the social set (B, D, E), if at all**, using the §4 answer.

**The regression harness, built during stage 0 and run at every stage:**

- **Verb-reachability corpus.** One natural-language action per verb, in a state
  where that verb *must* fire (e.g. an overdue mother present → `birth`). Assert
  the Custodian still emits it with gating ON. This is the direct test for
  "did we delete a mechanic" — it is the load-bearing test.
- **Prompt-diff review.** For a set of saved game states, dump the assembled
  prompt with gating off vs on and show only the removed lines, for your eye.
- **Full NL playthrough** (the standing requirement) with gating on.
- **Token report** per state, so the win is measured and not assumed.

**Rollback.** A single settings flag (`promptGating: off`) restores the static
prompt instantly, so a bad predicate found mid-playtest costs a toggle rather
than a revert.

## 7. Recipe for future verbs (TODO §0 second item)

Once gating exists, every new verb declares its own relevance predicate at the
point it is taught, so the vocabulary stays self-pruning as it grows instead of
accreting forever. The HANDOFF §2 recipe gains a step:

> **2b. Declare WHEN it is relevant.** Give the verb a pure predicate over
> engine state that answers "could this verb possibly apply this turn?".
> Default to `() => true`. Fail open. If the predicate is not obvious, that is
> a sign the verb is doing two jobs.
