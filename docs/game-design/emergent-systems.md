# RPG Custodian — Emergent Systems & Design Philosophy

_Companion to `core-mechanics.md`. Where core-mechanics froze the early spec
(stats, checks, stamina, breeding math), this doc captures the systems built out
2026-07-24 → 07-25 and, more importantly, **why** they are shaped the way they
are. Read the philosophy first; the mechanics fall out of it._

---

## 0. The one idea everything descends from

> **The engine owns the numbers. The Custodian owns the judgment. The effect
> vocabulary is the boundary between them.**

The whole extension is an argument about where to draw the line between a
frontier reasoning model and deterministic code. Get that line right and the
game feels alive and consistent at once; get it wrong and it either drifts into
nonsense (LLM doing arithmetic) or collapses into a rigid menu (code making
narrative calls).

Our answer, refined through every feature below:

- **Code decides _what is true_.** Every stat, pool, clock, relationship,
  pregnancy, curse, and inventory item is a value in extension-managed state.
  The model never stores, recalls, or computes a number. This is non-negotiable
  and was proven the hard way by the Stepped Thinking prototype, where
  LLM-accounted values drifted into incoherence within a few turns.

- **The Custodian decides _what should happen_.** Given the fiction, it judges:
  is this a moment that needs a dice roll? which stat? did the story just satisfy
  a condition? does this bite leave a lingering sickness or is it a scratch?
  should this potion be a one-use pre-buff or a day-long blessing? These are
  exactly the calls a skilled human GM makes — irreducibly contextual, not
  reducible to keyword tables.

- **The vocabulary is the contract.** The Custodian cannot do anything the engine
  has no _verb_ for. Emergent play works precisely as far as the effect
  vocabulary reaches, and no further. Every feature in this doc is, at bottom, a
  new verb (or a new way for an old verb to end). "Drink from a pool of liquid
  mana" only works because `restore_mana` exists; a wolf-bite disease only
  lingers because `add_status` exists. **When something the player tries falls
  flat, the fix is almost always a missing verb, not a smarter prompt.**

The corollary — and the reason we keep reaching for the reasoning model rather
than pattern-matching — is stated bluntly in the code review that shaped this
phase: _"Cheating by scanning input for keywords is entirely against the point."_
A keyword scan can catch "drink potion." It cannot judge that being carried
unconscious to an inn and abandoned there for three days is the kind of thing a
character should have _feelings_ about on your return. The reasoning model can.
So we spend it on judgment and let code do the bookkeeping.

---

## 1. The unified effect system

The single most important structural result of this phase: **buffs, debuffs,
blessings, curses, hexes, pacts, vows, oaths, diseases, poisons, drunkenness,
inspirations, one-use pre-buffs, AND quests are all the same thing.**

### 1.1 Why unify

We arrived here by demolition. The extension originally had _three_
overlapping mechanisms for "a temporary change to a character":

1. `apply_buff` / `rd.buffs` — timed stat nudges (4 steps, auto-expire).
2. `active_boosts` — encounter-scoped boosts consumed on the next stat check.
3. `add_status` — bespoke effects with narrative end-conditions.

Three systems that _sound_ alike are worse than one system that does more,
because the confusion is paid twice: the **Custodian** wastes judgment deciding
which near-identical verb to emit (and sometimes emits two, double-counting a
bonus), and the **next engineer** has to learn three code paths, three display
formats, three expiry rules. Dyna's call was decisive: _"the reduced confusion
of similar-sounding systems is very worth it."_ So `apply_buff` and
`active_boosts` were deleted outright and folded into `add_status`.

The philosophical payoff is bigger than tidiness. Once you see that a quest is
_"a silent status whose end-condition is its objective, that pays a reward when
met,"_ and a fey pact is _"a quest that also buffs you while you owe it,"_ you
stop building bespoke subsystems for each RPG trope and start composing them from
one primitive. New content becomes a matter of _describing_ an effect, not
_coding_ one.

### 1.2 The primitive

Every effect is one record in `customEffects` (on the player's `rpg_data`, or on
a per-NPC `relationship`). Its anatomy:

| Field | Meaning |
|---|---|
| `name`, `kind`, `polarity`, `desc` | Identity & framing. `kind` (buff/debuff/blessing/curse/pact/vow/disease/poison/quest…) picks the icon and wording; it is pure presentation. |
| `mods: [{stat, amount}]` | Flat stat changes that apply **the entire time the effect is active**. Works on any stat — the 4 core stats, plus NPC-relevant `fertility` and `stamina`. |
| `category` | `'status'` (an ongoing effect) or `'quest'` (a silent objective). |
| `reward` | Optional payout (gold/xp/tokens/item) granted when a quest completes. |
| **Three end-triggers, any combination, first to fire wins:** | |
| `expiresStep` (from `duration`) | A deterministic **timer** — N time periods, reusing the same expiry loop the old buffs used. |
| `endCondition` | A **natural-language condition** the Custodian invents, judged each turn (§2). |
| `expiresOnCheck` | A stat name — a **single-use pre-buff** spent the next time that stat is rolled. This absorbed the old `active_boosts` "encounter" trigger. |

Reads fold into the stat math through `customStatMod(stat)` (player) and
`npcStatMod(npcName, stat)` (NPC), which sum the mods of all active effects.
`effectiveStat = base + customStatMod + equipStatMod`.

### 1.3 Why three end-triggers, not one

Because "when does this end?" is genuinely three different questions, and a good
GM answers whichever fits:

- **Timer** — "you're drunk for the rest of the evening." Deterministic, needs no
  judgment, and critically serves as a **backstop**: even if the narrative
  condition never triggers, nothing lingers forever. (This backstop is what
  makes the condition-judge safe to be imperfect — see §2.3.)
- **Condition** — "the curse breaks with a loving kiss," "the blessing dissolves
  if you harm an innocent." The whole point of the game; expresses story logic no
  timer can.
- **Expires-on-check** — "I quaff a battle draught before the fight." A one-shot
  charge, spent by _using_ the stat, not by time passing. The Custodian is told
  to watch for these "before I try this, I…" pre-buffs.

Most lingering afflictions declare **both** a timer and a condition (`duration:12,
end_condition:"when cured"`), so they resolve either when treated or when they
run their course — exactly like real poison.

---

## 2. The task-satisfied condition judge

The engine that makes narrative end-conditions work, and the reusable heart of
the quest system.

### 2.1 What it does

After each turn's story lands on the page, if any active effect (or curse) has a
narrative `endCondition`/`breakCondition`, the engine makes **one** `generateRaw`
call — a strict rules-judge — asking, for each pending condition, whether the
story _just fully satisfied it_. Conditions that pass end their effect (a status
is removed, a curse lifted, a quest **completed with its reward**).

This is deliberately a **second, headless model call**, not part of narration —
the same architectural separation as the Intent Analyzer. Judgment about
game-state is never entangled with prose generation.

### 2.2 Why a judge instead of triggers

We could have demanded structured "completion signals" from the Custodian on
every turn. We didn't, because that pushes narrative bookkeeping onto the actor
generating the fiction, and because the interesting conditions are open-ended:
_"once he keeps his promise," "when the fever finally breaks," "if you ever raise
a hand to her."_ You cannot enumerate the ways a story satisfies those. You can
only _read the story and judge_. That is a reasoning task, so we spend a reasoning
call on it.

### 2.3 The two hard-won guards

Building this surfaced two failure modes worth remembering:

1. **Same-turn self-cancellation.** A freshly-applied affliction was being ended
   by its _own arrival narration_ ("...the sickness grips you" read as
   resolution). Fix: a `justCreated` flag makes an effect immune to its own
   end-check on the turn it is applied, and the GM narrator is explicitly told to
   narrate a just-applied effect _taking hold_, never fading. An effect becomes
   checkable only from the following turn.

2. **Over-eager judging.** Weak/cheap models read "a healer reaches for her herbs"
   as "cured." The judge's system prompt was hardened to demand the condition be
   _fully and unambiguously completed on-screen_ — approaching, offering,
   preparing, examining all return false. **But the real safety is structural,
   not prompt-tuning:** the timer backstop (§1.3) means a slightly eager judge
   costs at most a premature end, and a slightly lazy one costs at most a delayed
   one — never a stuck-forever effect. This is why Dyna's instinct to add a
   duration alongside the condition was the right call: it converts a correctness
   problem into a tuning problem.

### 2.4 Quests are this system wearing a hat

`add_objective` is just `add_status` with `category:'quest'`. Accepting any
task/oath/errand/pact puts a silent effect on you; the judge watches its
objective; completion grants the reward and removes it; a timed quest that
expires "fails." A fey pact is the same record with `mods` that hold _while you
owe it_ and a reward when you deliver. No separate quest engine exists, and none
should — that was the entire point of proving the primitive.

---

## 3. Bespoke, Custodian-invented effects

The Custodian does not pick from a fixed list of statuses. It **invents** them —
name, kind, polarity, the fitting stat mod, and the end-condition — from the
fiction, live. This is the sharpest expression of the "judgment over keywords"
thesis, and the acceptance test for it was explicit and unassisted:

> _Get into a fight with a pack of disease-ridden wolves, contract the illness as
> a bespoke status effect, seek out Fern the herbalist, be cured — all emergent,
> with none of these examples given to the Custodian as instructions._

It works. From "its rotting fangs sink into my forearm" the Custodian creates
_Wolf-Bite Rot_ (a `disease`, `-2 ruggedness`, ends "when cured with medicine or
magic," duration 12 as backstop); your effective strength actually drops; the
effect survives travel and conversation; when Fern's poultice is genuinely
administered the judge ends it and your strength returns.

The design guidance that makes this reliable is a _category_ lesson, not an
example list: the prompt tells the Custodian that **anything the story inflicts
or bestows that lingers past this moment is a status** — illness, poison, a
draining wound, exhaustion, fear, inspiration, an enchantment — and must not
evaporate as flavor or be collapsed into one-off `damage`. Teach the shape of the
category, not the instances, and the model generalizes to instances you never
listed.

---

## 4. Equipment — appraised, not authored

Items carry a **Custodian-appraised effect string** shown beside the name, plus a
structured modifier. When any item enters the inventory, a queued (never racing
the analyzer) `generateRaw` call invents a brief, balanced effect:

- Druidic Staff → "+1 Craftiness in nature"
- Trusty Lantern → "No penalty in the dark"
- Amulet of Charm → "+1 Charm"

Two deliberate distinctions:

- **Flat vs. contextual.** A flat bonus (Amulet of Charm → always +1) folds
  directly into `effectiveStat` via `equipStatMod`. A **contextual** one ("+1
  Craftiness _in nature_") is _not_ summed blindly — it is surfaced to the
  Custodian, which weighs it into the DC when the situation matches. Code handles
  the unconditional; judgment handles the conditional. Same division of labor as
  everywhere else.

- **The inventory is the menu.** Tapping an item equips gear (toggle) or uses a
  consumable; NL ("I clasp the amulet around my neck") does the same via
  `equip_item`. There is no separate equipment screen because the item list
  already _is_ the interface.

Why appraise at add-time rather than author effects on items? Because items come
from _anywhere_ — a quest reward, a crafted object, a thing an NPC hands you in
prose, a soul crystal born of a curse. Authoring effects would mean every content
source pre-declares balance; appraisal means the world can invent items and the
engine gives them meaning on arrival. The economy and the fiction stay decoupled.

---

## 5. Breeding, birth, and consequence

Pregnancy (from `core-mechanics.md` §6) now runs to term and _delivers_, and the
whole arc is built to make intimacy have **lasting world-state consequence**
rather than being a scene that resets.

- **`birth` effect.** The Custodian watches for a term/overdue mother delivering
  and emits one birth per message for however many emerge. The engine — never the
  model — awards Power Tokens, names the young, and files them. (The model is
  explicitly forbidden from inventing tokens, names, or fertilization results;
  those are ground truth.)

- **Three offspring kinds, decided at conception:** `live` (human → children,
  tokens), `egg` (monster-girl races → eggs that hatch after ~2 days), `crystal`
  (a soul-mage sire or the Crystal Curse → inert soulgems, **no tokens** — they
  are spell-fuel, not heirs). Kind is fixed at conception so the pregnancy "knows"
  what it carries.

- **Offspring persist as world-state.** They linger at the mother's home as an
  area footnote (👶/🥚/🐣/💎). Birth is not a cutscene; it leaves something in the
  world you can return to.

- **Off-screen solo birth.** If you never come back to help, a severely overdue
  mother (150%) gives birth **alone**, off-screen — logged for the reunion system
  (§6) so she can react to having gone through it without you. Absence has weight.

The through-line: every romance mechanic is wired so that _what you do echoes
later_. That is the difference between a sandbox and a set of disconnected scenes.

---

## 6. The living world — continuity, absence, and self-knowledge

A cluster of features whose shared purpose is that **the world keeps existing
when you look away, and remembers when you look back.**

- **Reunion priming.** When you return to an NPC after real elapsed time, her
  first reply is preceded by an ephemeral, one-shot briefing: how long it's been
  (in plain words), that she spent it living her own life (her schedule), your
  standing with her, and any major thing that happened in the gap. Without this
  she resumes the old scene as if no time passed — the single most immersion-
  breaking failure of naïve LLM roleplay. "Seen" is marked whenever she replies
  or time passes _with you present_, so lingering together never reads as an
  absence.

- **Self-knowledge.** Each present NPC's home and daily routine ride in the live
  status block, so "where do you live?" / "what do you do all day?" get honest
  answers from her own card — not confabulation.

- **Unconscious NPCs stay where left.** A KO'd companion is pinned to where she
  fell (overriding her schedule), wakes on her own after ~2 periods, and — if she
  wakes somewhere you aren't — records that she woke _alone_, feeding the reunion.
  Carrying her to an inn and abandoning her is a thing that _happened to her_, and
  she knows it.

- **Conscious departures are in-character.** Dismiss a companion and she says
  goodbye naming where she's headed on her schedule ("I'll be at the outskirts
  this evening — you know where to find me"), so the world's comings and goings
  read as choices, not despawns.

- **Scene grounding.** Current location + time-of-day is the _first line_ every
  NPC and the narrator read, and is injected into every appraisal/description
  prompt. Fixes the "described as standing in a forest while at the inn" drift.

None of this is AI cleverness — it is all **programmatic context composed from
state and handed to the model at the right moment.** The model supplies the
feeling; the engine supplies the facts it feels about.

---

## 7. Magic — the seed layer

Not a spell system yet, but the substrate one will grow from:

- **Mana** (`max = Craftiness`) with a free-form `restore_mana` verb — any arcane
  source (a mana font, a potion, meditation at a ley-line) refills it. This verb
  exists specifically because a robustness probe — "would _drink from a pool of
  liquid mana_ work?" — revealed the gap. The lesson recurs: **the vocabulary is
  the world's ceiling.**

- **The Crystal Curse** — the first true debuff-with-lore. A dark affliction
  (permanent until broken, or timed) that turns the afflicted's issue to inert
  soulgems. Applying it is a **contest** — caster's Craftiness (or a trap/item's
  proxy power) vs. the victim's Ruggedness — the reusable template for how every
  future curse/debuff gets _resisted_. Soul crystals it produces are collectible
  spell-fuel (+1 Mana each), closing a loop from curse → birth → resource.

- **The lorebook.** A real SillyTavern World Info book, auto-created and bound to
  the Game Master character, holding the Crystal Curse and Soul Crystal entries.
  Crucial architectural fact learned here: **`generateRaw` does not scan World
  Info**, so the _Custodian never sees lorebook entries._ Rules live in the
  Custodian's system prompt; the lorebook is flavor for the roleplaying models.
  Mechanics and lore are separate channels by design.

---

## 8. What the Custodian actually sees (and doesn't)

Because the whole thesis is "spend the reasoning model well," its input budget is
managed deliberately:

- **Doubled, spam-filtered scene window.** The analyzer sees the last ~12 _story_
  messages at 400 chars — and `isStoryMessage()` strips the mechanical chatter
  (travel/time/look notices, ghost logs, the character sheet, skill-check
  readouts) so the whole budget is spent on narrative and dialogue, which is what
  judgment needs.

- **Live state as natural language.** Stats, stamina/mana, dispositions,
  routines, active effects, equipment, curses — all projected through tier tables
  and templates into sentences the model reads as meaning, not digits.

This is the same principle as everywhere: give the model the _fiction and the
stakes_, keep the arithmetic and the plumbing out of its face.

---

## 9. The current effect vocabulary (the contract, as of 2026-07-25)

World/pacing: `move` · `advance_time` · `rest` · `examine`
Party: `add_party` · `remove_party`
Economy/items: `add_item` · `remove_item` · `buy_item` · `use_item` ·
`equip_item` · `unequip_item` · `adjust_gold`
Quests: `add_objective` (bespoke, engine-judged — the pre-authored card-quest
verbs `accept_quest`/`complete_quest`/`turnin_quest` were demolished 2026-07-25
after colliding with an emergent job; ALL quests are add_objective now)
Social/romance: `adjust_affection` · `adjust_arousal` · `orgasm` · `birth`
Health/resource: `damage` · `heal` · `restore_mana`
Effects: `add_status` · `remove_status` · `adjust_stat`
Curses: `apply_curse` · `lift_curse`

Every one of these is a promise the engine keeps deterministically, and a lever
the Custodian may pull from prose. The art of the project is keeping this list
_expressive enough that players rarely hit its edge_ while _small enough that the
Custodian can hold it all_ — a tension §10 of the handoff addresses directly.

---

_For how to extend all of this — architecture map, the recipe for adding a verb,
the testing method, and known sharp edges — see `../HANDOFF.md`._
