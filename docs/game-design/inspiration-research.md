# Inspiration & Prior-Art Research

Research digest for RPG Custodian, 2026-07-23. Sources: Dyna's Stepped
Thinking prototype (local), Lord-Raven's Chub stages (GitHub/Chub), Elthial's
SillyTavern-Map (GitHub).

## 1. Dyna's Stepped Thinking prototype (local, `dyna-stepped-thinking`)

The closest ancestor of RPG Custodian's stat system. A Stepped Thinking
"thinking prompt" runs a separate LLM pass before each reply, acting as a
"STAT ANALYZER BOT" that updates three per-character stats in a `[STATS]`
block: **Affection to {{user}} (1–10)**, **Sexual Arousal (1–10)**, and
**Pregnancies + Growth Progress %** with named stage bands (Zygote 5–9% …
Birth Overdue 100–120%). Full prompt lives in `settings.json` under
`extension_settings["dyna-stepped-thinking"]` (default-user).

**What it got right (adopt):**
- Reasoning-before-value: each stat change is justified in one line, then the
  value is stated ("+2 Affection!"). Great for game feel and model steering.
- Tier labels with behavioral meaning: "8/10 (Loved and Trusted)", "6/10 (Hot
  and Bothered)" — the value→tier→behavior projection now specced in
  core-mechanics §8.
- Hard rules encoded in prose: arousal 10 forces climax then resets to 1;
  arousal decays slowly; caps at 10. These become engine rules.
- Pregnancy stage bands and always-advancing progress — adopted verbatim.

**What it proves doesn't work (the reason RPG Custodian exists):**
- The LLM is the accountant: values drift non-sensically, it forgets previous
  values despite "IMPORTANT: pay attention to previous STATS pages", and it
  can't do "+2 from 6" reliably over long play.
- Every reply costs an extra LLM round-trip just for bookkeeping.
- State lives in chat messages — unsaveable, unbranchable, invisible to code.

**Migration idea:** keep Stepped Thinking's *Critical Thinking* prompt for
in-character reasoning (it's good), drop the stat prompt entirely once the
engine owns stats; the engine's projection layer replaces the `[STATS]` block.

## 2. Crunchatize — Lord-Raven / @Ravenok on Chub

"Turn any chat into a simple, stat-driven RPG." Stage that distills **every
user input** into a skill check against one of eight attributes.

Key design facts:
- **PbtA-inspired 2d6 + modifier**, four outcomes: failure / mixed success /
  success / critical (double sixes). Configurable universal difficulty
  modifier.
- **XP on failures and criticals**, level-up increases one of the stats you
  used most that level. Elegant self-balancing: you grow in what you attempt.
- Eight deliberately fuzzy stats: Might, Grace, Skill, Brains, Wits, Charm,
  Heart, Luck. (Fuzzy is fine when a classifier picks the stat; our four
  named stats + GM tool calling makes the mapping explicit instead.)
- **Agency transfer**: the bot is instructed to take the check result and
  paraphrase the player's action as it narrates — player input is intent,
  not canon. Directly applicable to our GM prompting.
- Implementation warning: used zero-shot classification (HuggingFace-hosted)
  to pick stat + difficulty per input — naive, context-poor, easily skewed by
  wording, and dependent on an external backend that broke repeatedly (CORS,
  quota, forced updates). **Our approach — the main model choosing checks via
  function calls — has full context and no extra infra.** Validation: he had
  to add code trimming "fake statblocks" the LLM hallucinated into replies;
  we should plan the same guardrail (core-mechanics §11).
- Repos: `Lord-Raven/Crunchatize` (live), `crunchatize-zero` ("Full Crunch.
  No Fluff." variant), `crunchatize-2` (WIP successor, "This time, it's
  personalized" — private/unfinished as of research date).

## 3. Statosphere — Lord-Raven's generalized stat framework

"Define variables and create advanced behaviors triggered by bot
interactions." A config-driven engine (JSON authored in an external editor)
with five elements: variable definitions with update phases; custom JS
functions; zero-shot/LLM classification rules; generators (extra LLM calls
for text/images); and content-modification rules (rewrite input/response,
inject hidden "stage directions").

Takeaways for us:
- His update-phase taxonomy (pre-input / pre-response / post-response) is a
  clean mental model for when engine hooks should run in the generation
  cycle; maps to ST's GENERATION_STARTED / MESSAGE_RECEIVED events.
- "Stage directions" = hidden per-turn instruction injection — same mechanism
  as our re-encounter priming and stat projection injections.
- Data-driven rules (tier tables, schedules, worlds as JSON) beat hardcoding —
  matches our worlds-as-cartridges philosophy.
- His pitfalls list is a checklist for us too: obfuscated behavior (document
  what the extension injects), config fragility (version the save schema),
  extra LLM calls = slower + costlier (batch/piggyback where possible).

## 4. SillyTavern-Map — Elthial

Clickable-map extension for ST: overlays user-defined SVG hotspots on a
background image inside a MovingUI dialog; hover highlight + click runs an
STscript command; maps chain hierarchically (Town → Building → Room) with
back-navigation; loaded via dropdown or `/Map <file>`.

Takeaways:
- Map = PNG + JSON hotspot list `{id, path, color, script}` — cheap,
  authorable, and fits our worlds-are-content model perfectly. A future
  visual travel UI could ride on our existing world JSON: each connection
  gets an optional hotspot polygon, click = engine `move` call (not raw
  STscript).
- Confirms MovingUI dialogs are a viable surface for game UI beyond the chat
  stream (map, character sheet, party panel).
- V1 caution: hand-authoring SVG paths is tedious — if we go visual, we need
  an editor mode or accept rectangles.

## 5. Synthesis — what RPG Custodian does differently

Every prior art either (a) lets the LLM keep the books (Stepped Thinking,
Statosphere classifiers) or (b) bolts a classifier pipeline outside the main
model (Crunchatize). We combine the working halves: **engine-owned state**
(nobody else's numbers drift) + **main-model tool calling** (full-context
mechanical judgment with no external backend), projected back into the prompt
as **tiered natural language** (Stepped Thinking's best trick, made honest).
