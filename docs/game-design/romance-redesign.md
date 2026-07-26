# Romance Redesign — Reaction-Judged Affection & Decoupled Charm

_Design plan, 2026-07-25, from Dyna's vision. Status: **IMPLEMENTED**
2026-07-25 (all four pillars + valve; test/romance-redesign-test.js 10/10).
Supersedes the affection guidance in core-mechanics §5b where they conflict._

## 0. The problems (observed in live play)

1. **Affection only moves on proposition charm checks** (+1 success / −1 fail,
   analyzer prompt). Weeks of narrative trust-building score zero; then HER
   OWN invitation to cuddle rolls DC 12, the player rolls 11, and her affection
   *drops*. Total ludonarrative dissonance.
2. **Affection doesn't gate NPC behavior.** A 0-affection NPC can invite you to
   her bed — nothing tells her model she wouldn't.
3. **Arousal is a number with no body.** Projected only as "visibly aroused
   (N/10)" at ≥4; no physical ladder, no decay, no teeth.

## 1. The four pillars

### A. Verbose tier projection with behavioral ceilings (the gate)

`affectionTier()` grows from one sentence to a rich band description used
everywhere the number currently leaks:

- **Inner stance** — what the player is to her at this tier, in her own head.
- **Body language** — distance kept, touch tolerated, how she meets his eyes.
- **Freely given** — what this tier allows without any persuasion.
- **The ceiling** — what she would NOT yet do, stated plainly ("she would not
  seek him out, share private space with him, or accept an invitation to
  intimacy — and she does not extend such invitations herself").

A matching **arousalTier()** ladder (calm / stirred / flushed / aching /
desperate bands) describes the *physical* state: breath, skin, fidgeting,
proximity-seeking, what her body does regardless of what her pride says.

Projected into: `projectPlayerStatus()` dispositions (each present NPC "plays
her own line" — this is the inhibition), the GM narrator, `examineNpc` flavor,
and the analyzer's NPC context (so DCs and judgment read the same truth).
This is pillar-zero: **the gate is the projection.** A Wary NPC whose
instructions say she doesn't extend intimate invitations structurally cannot
warmly invite you in — and if she *does*, that's a band-break the judge (C)
will catch and promote.

### B. Charm decoupled from affection (checks keep the drama, lose the scoring)

- **Remove** `adjust_affection` from proposition success/failure guidance
  entirely. A charm check NEVER moves affection by itself.
- **Reframe the check's meaning** in the analyzer prompt: a charm roll decides
  whether she accepts your *framing* — reads your words as trustworthy and in
  her interest — not whether she likes you more. DC still scales with boldness
  and is still discounted by affection (and arousal, see D): trust makes
  persuasion easy. That keeps the dice drama Dyna wants.
- **Check-interpretation note (new):** the roll's outcome is fed to the NPC as
  a one-shot ephemeral injection before her reply (same mechanism as the
  reunion note, `setExtensionPrompt` depth 0, cleared after):
  - **Critical:** "His words land better than he could have hoped — she
    believes him completely and finds herself moved."
  - **Success:** "She reads him as sincere / sees it his way; she is inclined
    to go along."
  - **Mixed (DC−3 band):** "She half-believes him — wanting to, not quite
    able to; she hedges."
  - **Failure:** "She sees through it / is not persuaded — she reacts to what
    she actually perceives, not to what he claimed."
  Note the failure phrasing: it does NOT command coldness. The dragoness who
  smells the lie through your brave face may find it *delightful* — her
  reaction is hers, generated from her character + tier + the see-through
  instruction. If that reaction is warmer than her band, the judge promotes
  her. **A failed roll can build affection.** That's the emergent push-pull.
- **No check on HER initiative:** the analyzer is told — accepting what an NPC
  has herself offered or initiated is NEVER a proposition and rolls nothing.
  Only the player pushing PAST what is offered rolls charm.
- **Lane-narrow the verbs:** `adjust_affection`/`adjust_arousal` remain in the
  vocabulary but only for *external/mechanical* causes — a charm potion, a
  lust spell, a curse, an explicit magical effect. Conversational warmth is
  the reaction judge's lane, never the Custodian's. (Lane discipline per
  HANDOFF §5 — pick one, never both.)

### C. The reaction judge (new post-reply stage — the heart)

After an addressed NPC's reply lands (end of `triggerNpcReply`), one small
`generateJson` call judges HER BEHAVIOR against HER BAND:

- **Inputs:** her current affection band description + ceiling, her arousal
  band, the player's message, her reply (and a short scene tail for context).
- **The question (the test Dyna specified):** *not* "is this affectionate?"
  but "is this behavior MORE warm/trusting/open than her stated band allows —
  despite her band being her instruction? Or notably COLDER/more withdrawn
  than the band?" Within band → 0 (the default, stated strictly, same
  hard-won strictness as the conditions judge). Outside → ±1 (±2 reserved for
  extreme moments — a betrayal witnessed, a life saved).
- **Arousal judged in the same call**, on physical evidence in her reply
  (proximity, breath, flush, touch, fluster) — it may move faster (±2).
- **Why this works:** her reply was generated WITH her band projected as
  instruction. If the roleplay model — holding her character, the scene, and
  her stated reserve — still wrote her warmer than the band, the moment
  earned it. The NPC model is the affection oracle; the judge only detects
  band-breaking. And it automatically captures "affection comes from how the
  player *reacts* to her": his reactions move her; her reply shows it; the
  judge reads her.
- **Engine clamps:** hard ±1 per turn normally (±2 extreme), plus a pacing
  cap (knob #1) so tiers are climbed over sessions, not speedrun in a scene.
  0–10 bounds as today. Movement produces a small ghost line only on tier
  BOUNDARY crossings ("💗 Wren seems to have warmed to you — Cordial →
  Warming") so progress is felt but not scorekeeping-noisy.

**Cost:** one extra small judge call per addressed-NPC turn (think-first
budget ~220 + headroom). If it proves heavy, batch it into the same call as
`checkPendingConditions` later. The Custodian prompt itself NET SHRINKS
(check-affection guidance removed, verbs lane-narrowed, no new verbs) — no
overload.

### D. Arousal with teeth (the physical channel)

- **Decay:** arousal ticks toward baseline 1 by 1 per time period (in the
  existing expiry loop). Bodies cool off; affection doesn't.
- **Post-coital safety valve (engine rule, no judgment):** orgasms spend the
  actor's Stamina, so exhaustion IS the post-coital state. When an NPC's
  stamina falls to 1, her arousal caps at 5 ("running out of steam"); when it
  hits 0 (KO), arousal is set to 2 ("satisfied"). Applied at the moment
  stamina drops, wherever it drops.
- **Feeds the DC:** proposition DCs are discounted by affection AND current
  arousal band (an aching body argues your case). Already partially true via
  affection; make arousal explicit in the analyzer's DC guidance.
- **Projected physically** (pillar A ladder) to NPC, GM, and examine flavor —
  the examine tiers become the same `arousalTier()` source of truth.

## 2. What does NOT change

2d6 + stat vs DC, the boldness ladder, outcome tiers, stamina/orgasm/
fertilization flow, statuses/conditions machinery, reunion/continuity,
`adjust_affection` as a debug/mechanical-effect verb. No new Custodian verbs.

## 3. Pipeline after the change

player msg → analyzer (proposition? → charm check; NO affection effects)
→ roll → apply effects → GM narrates outcome
→ **interpretation note injected (one-shot)** → NPC reply (sees verbose bands)
→ **reaction judge reads her reply → ±affection/arousal (default 0)**
→ conditions judge (unchanged) → save.

## 4. Build order

1. `affectionTier()`/`arousalTier()` verbose bands + ceilings; rewire all
   projections (A, D-projection).
2. Analyzer prompt surgery: decouple, reframe, her-initiative rule,
   lane-narrowing (B).
3. Interpretation note in the check→reply path (B).
4. Reaction judge + clamps + boundary-crossing ghost lines (C).
5. Arousal decay + DC discount (D).
6. Headless tests: in-band politeness → 0; clear band-break → +1; charm-fail
   no longer −1; her-invite → no roll; interpretation note present; arousal
   decays; full NL courtship-arc playthrough.

## 5. Knobs (signed off by Dyna 2026-07-25)

1. **Pacing cap:** affection gain capped at +1 per time period per NPC (a
   perfect day tops out at +4). Downward movement uncapped.
2. **Extreme swings:** ±2 allowed when the judge flags "far outside band"
   (betrayal witnessed, life saved); otherwise ±1.
3. **Arousal motion:** ±2 per turn, −1 per time period decay toward 1.
4. **Post-coital valve:** stamina 1 → arousal capped at 5; stamina 0 →
   arousal set to 2 (see §D).
