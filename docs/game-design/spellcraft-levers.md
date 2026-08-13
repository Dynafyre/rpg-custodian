# Spellcraft Pass 2 — The Levers

_Every distinct thing a spell may do to the engine or the narrative. This list
is the Spell Artisan's entire permitted vocabulary: a spell record is a bundle
of levers plus flavor, and **nothing off this list can be cast**. Levers marked
**[EXISTS]** are live engine machinery today; **[NEW]** need building, ranked
S/M/L for effort._

---

## A. Numbers & resources
- **A1. Damage** [EXISTS] — Stamina off anyone (`damage`).
- **A2. Heal** [EXISTS] — Stamina restored, revives (`healStamina`).
- **A3. Mana restore** [EXISTS] (`restoreMana`, soulgem crush).
- **A4. Items & gold** [EXISTS] — conjure/transform/destroy via item verbs; appraisal.
- ~~XP / Power Tokens as spell OUTPUT~~ — forbidden. Engine pays those; magic never mints progression.

## B. Statuses — the workhorse (one lever, many faces)
- **B1. Stat-mod status** [EXISTS] — ±N to any stat, incl. NPC fertility/stamina/affection/arousal (external-magical lane is EXACTLY the spell lane).
- **B2. Cap status** [EXISTS] — `{stat, cap:N}`: seals a capacity (Chastity Ward, Cold Water's hard form).
- **B3. Narrative-only status** [EXISTS] — `mods:[]` + binding desc: compulsions, transformations, vows, Tongue-Tie, Heat, lactation, Utterly Spent-likes. The single biggest school-carrier.
- **B4. Immobilize pin** [EXISTS] — Winter's Grip, Circle of Binding.
- **B5. Refertilize flag** [EXISTS] — plug-family mechanics.
- **B6. End-triggers** [EXISTS] — timer / judged end-condition / spent-on-next-check. Wards that "hold until X" are just condition-watched statuses.
- **B7. Event-charged status** [NEW-M] — a status consumed by the NEXT event of
  type T, firing a payload: `expiresOnDamage` (Turnaside absorbs, Backdraft
  reflects), `expiresOnEntry` (Silent Bell pings), generalizing
  `expiresOnCheck`. One new field family, big ward school unlocked.

## C. Checks & contests
- **C1. Contested cast** [EXISTS] — 2d6 + power vs base + resist (`debuffContest`), adversarial tint, XP on player wins.
- **C2. DC nudge** [EXISTS] — clamped ±2 situational (Action Judge).
- **C3. One-use pre-buff** [EXISTS] — Stone Fist, courage-for-one-trial.
- **C4. Forced reroll** [NEW-S] — Evil Eye: sour one success into a reroll. (Also the future Power-Token "burn fate" — same lever, two fuels.)

## D. Bodies & breeding
- **D1. Fertility mods/caps** [EXISTS] — Kindle Womb, Fallow Field (cap 0).
- **D2. Cycle shift** [NEW-S] — `rel.cycleOffset` folded into `cycleStep`: Blossom Out of Season moves her actual tide. (Grounded language rules apply.)
- **D3. Conception event** [EXISTS] — `rollFertilization(shots)`; Consecrated Union = fertility surge + guaranteed-window framing, never a decreed result.
- **D4. Pregnancy surgery** [NEW-S] — set/add progress (Self-Conception's 130% record), freeze flag (Womb of Stone), kind override (Soulgem Ripening).
- **D5. Sire field** [NEW-M] — breeding records carry explicit sire (Borrowed Stag); credit-vs-source split.
- **D6. Derived-stat rule** [NEW-S] — her virility = f(her fertility) while spellbound.

## E. Presence & space
- **E1. Move/translocate player** [EXISTS] — `move`/`event_teleport` reach anything, incl. node-isolated planes. **Hell IS a location** — a plane is a disconnected subgraph; Hell's Gate is event_teleport + passengers.
- **E2. Summon NPC** [EXISTS] — pull + revival-style pin (Summon Lover).
- **E3. Dismiss/return NPC** [EXISTS] — clear pins → schedule (Send Her Home, Banish).
- **E4. Passengers** [NEW-S] — party members ride a teleport (add_party mechanics already move them with you; a gate just moves the whole party).
- **E5. Conjured location** [NEW-M] — inject a temporary node-isolated location (Pocket Parlor), with teardown returning occupants. The world already supports isolated nodes; the new part is lifecycle.
- **E6. Area ward flag** [NEW-M] — location-attached statuses: Anchor (no summon/teleport), Hearth Ward (entry condition), Wardlight. Likely implemented as mechanical area-notes the engine reads.

## F. Time
- **F1. Advance** [EXISTS] — Stolen Hour = `advanceTimeBy` with shared-pleasant framing.
- **F2. Rewind** [EXISTS] — the timeUndo snapshots ARE Chronomancer's Regret; the spell is a costed, diegetic gate on machinery we built for the menu.
- **F3. Defer/stretch** — CUT as mechanics (Long Candle, Velvet Hours become narrative statuses; the clock doesn't need a third verb).

## G. Information — engine-truth divination (the crown jewels)
- **G1. Whereabouts/schedule read** [EXISTS] — Scrying Bowl, True North.
- **G2. History walk** [NEW-S] — schedules over a past window + adjacency ("seen passing") — Whisper of the Walls. Layer session pins/summons for honesty.
- **G3. Banded body/heart reads** [EXISTS] — affection/arousal bands (Heartsight), cycle in grounded language (Moonsight), pregnancy count/kind/stage (Quickening Sight). Rendering rules already written.
- **G4. Secrecy reveal** [NEW-S] — flip a secret location visible / mark known (Seeker's Nose); reveal a secret area note.
- **G5. Presence sweep** [EXISTS] — who's here + adjacent (Life-Light).
- **G6. Appraisal** [EXISTS] — Appraiser's Eye = the appraiser, instant.
- **G7. MIND READING** [NEW-L] — the new organ: a directed judge over her
  replies and/or her model's thought blocks, past or armed-for-next, with a
  spell-supplied question ("report deception", "parse her feelings toward
  me"). Powers Liar's Bell + deep Heartsight. The Artisan gets it as a TOOL
  with strict rules of use.
- **G8. Omen** — Auspice: a Custodian meta-answer about a plan, honest but vague. Narrative-grade; cheap.

## H. Narrative & perception control
- **H1. GM beat** [EXISTS] — the obvious-cast narration (Summon Lover's arrival pattern).
- **H2. Per-NPC one-shot note** [EXISTS] — the subtle/imperceptible workhorse: she feels X, source unknown (secret-note machinery).
- **H3. Public scene effect** [EXISTS] — status-block visible effects; ambience decoration via area notes (Moonlit Stage, Rain Call = public area note + GM framing — the SAFE illusion class).
- **H4. Witness surgery** [NEW-M] — strip/edit `present` arrays: Forget-Me (her memory only), Veil of Dull Eyes (observers don't log you).
- **H5. Persona rewrite** [NEW-M] — disguise: name/description text swap, avatar-key untouchable, crash-safe restore.
- **H6. Player interlude** [NEW-M] — agency suspended, GM narrates, mechanical release condition (Self-Conception, Beastshape). Reusable for capture/KO states.
- **H7. Illusion containment kit** [NEW-L, DEFERRED] — judge-exclusion flag + restoration seed + scoped GM frame. Reality-forking illusions wait for this; nothing else should.
- **H8. Visibility class** [record field] — obvious / subtle / imperceptible: chooses H1 vs H2 vs nothing, and who reacts.

## I. The record's own axes (not levers — pricing dimensions)
tier · mana cost · visibility · range ring (touch/scene/area/anywhere/plane) ·
targets (self/one/few/room) · contested? · preconditions (outdoor tag, touch,
consent, night…) · fuel surcharges (Power Token, soulgems) · duration class.

---

## The compression pass — proposed cuts & merges

The Artisan makes any stat-buff trivially; the catalog shouldn't hoard ten.
- **MERGE** Smolder + Rose-Tinted Veil + Aphrodite's Tide → one spell, target
  axis (one woman / the room). Keep the Veil name.
- **MERGE** Frostbite + Winter's Grip → Winter's Grip (slow → pin is just magnitude).
- **MERGE** Mesmer's Lantern + Sleep of the Meadow → Sleep of the Meadow.
- **MERGE** Witchlock + Hearth Ward → Hearth Ward (a door is a small hearth).
- **MERGE** Mend + Deep Mend → Mend (tier axis handles depth). Same for any "greater X".
- **CUT** Bloodhound's Word, Name on the Wind (Scrying + Sending Thread cover them).
- **CUT** Twin Star (fertility magnitude already multiplies conceptions via shots).
- **CUT** Long Candle as mechanics (→ narrative status), Dowsing (Seeker's Nose covers), Mirror's Favor (Glamour cantrip covers).
- **RECLASS** Velvet Hours, Moment of Gold, Petalfall, Firefly Veil → pure-narrative
  class: flat 1 mana, H1/H3 only, no mechanical record beyond the note.
- Everything else stands; the spicy school survives intact (each pulls a
  distinct lever, which is exactly why it felt fresh).

## Economy strawman (to argue with)

**Tiers**: Cantrip 1 · Lesser 2 · Greater 4 · Ritual 6 (ritual = takes the
scene, visible casting, interruptible).
**Magnitudes by tier**: damage 1/2/4/6 · stat mods ±1/±1/±2/±3 · durations
scene/period/day/until-condition.
**Surcharges**: subtle +1 · imperceptible +2 · range: scene +0, another area +1,
anywhere-known +2, **cross-plane +6** · targets: self/one +0, each extra +1,
whole room +3 · permanence beyond a day: +1 Power Token · contested spells cost
full price win or lose (the dice are the discount).
**Fuel**: mana pool = Craftiness; each soulgem burned = +3 mana toward a single
cast (the crystal economy becomes the high-magic fuel); Power Tokens buy
permanence and fate-bends, never raw power.

**The Hell's Gate worked example**: Ritual teleport 6 + cross-plane 6 + two
passengers 2 = **14 mana** — beyond any natural pool, castable at Craftiness 8
with two soulgems burned (8+6). Three lives ferried to Hell costs the stored
souls of two unborn crystals. The economy *says something*. That's the test of
whether a price is right.
