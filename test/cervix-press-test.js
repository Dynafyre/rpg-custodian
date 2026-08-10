// Two spicy mechanics:
// 1) A confirmed impregnation pays flat 100 XP (shared rollFertilization site,
//    so creampies and Cum Plugged ticks can never drift apart).
// 2) The cervix_press verb: Ruggedness contest vs DC 6 + HER remaining
//    Stamina. Success → Sanctuary Breached (+10 fertility, 2 periods) + the
//    breach wrings a climax out of her (−1 her Stamina). Miss → her reply
//    plays a tight, unyielding cervix, never "he failed". Inert if she
//    already bears the status. GM narration is gated out (asserted via the
//    NL probes only being analyze-level; gate flag is code-inspected).
import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A bold adventurer.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };
const chatLen = () => D(() => SillyTavern.getContext().chat.length);
const tail = (n) => D((n) => SillyTavern.getContext().chat.slice(n).map(m => m.mes).join('\n'), n);

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);

  // ── 1) Impregnation XP ──
  await D(() => window.rpgCustodianDebug.addStatus('Marta', { name: 'Test Certainty', mods: [{ stat: 'fertility', amount: 100 }], duration: 4 }));
  const xpBefore = await D(() => window.rpgCustodianDebug.xp());
  let before = await chatLen();
  await D(() => window.rpgCustodianDebug.orgasm('Marta', true, 1)); await wait(300);
  const hits = await D(() => window.rpgCustodianDebug.rel('Marta').pregnancies);
  const xpAfter = await D(() => window.rpgCustodianDebug.xp());
  check('every confirmed impregnation pays 100 XP', hits > 0 && xpAfter - xpBefore === 100 * hits, `${hits} conceived, +${xpAfter - xpBefore} XP`);
  check('the ghost line announces the XP', (await tail(before)).includes(`+${100 * hits} XP`));
  await D(() => window.rpgCustodianDebug.setPreg('Marta', 0, 0));
  await D(() => window.rpgCustodianDebug.removeStatus('Marta', 'Test Certainty'));
  await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });   // drop the test status's own reaction note
  await D(() => window.rpgCustodianDebug.heal('player', 'full'));

  // ── 2) cervix_press: forced MISS (her stamina 10 → DC 16; his effective 0 → max 15) ──
  const eff = await D(() => { const c = window.rpgCustodianDebug.rollCheck('ruggedness', 8); return c.eff; });
  await D((amt) => window.rpgCustodianDebug.buff('player', 'ruggedness', amt, 'Test Sap'), 0 - eff);
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 10; });
  before = await chatLen();
  await D(() => window.rpgCustodianDebug.cervixPress('Marta')); await wait(300);
  let t = await tail(before);
  check('miss: her cervix holds', t.includes('holds fast'), t.slice(0, 120));
  check('miss: DC shows her stamina stiffening it', t.includes('DC 16') || t.includes('her 10 Stamina'));
  check('miss: no status landed', !(await D(() => window.rpgCustodianDebug.statuses('Marta'))).some(s => s.name === 'Sanctuary Breached'));
  let note = await D(() => window.rpgCustodianDebug.statusNote('Marta'));
  check('miss: her reply note plays the unyielding sphincter', /unyielding/.test(note) && !/fail/i.test(note), note.slice(0, 100));
  await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Test Sap'));

  // ── forced SUCCESS (her stamina 1 → DC 7; his effective 12 → min 11) ──
  await D((amt) => window.rpgCustodianDebug.buff('player', 'ruggedness', amt, 'Test Might'), 12 - eff);
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 1; });
  const fertBefore = await D(() => window.rpgCustodianDebug.fertilityOf('Marta'));
  before = await chatLen();
  await D(() => window.rpgCustodianDebug.cervixPress('Marta')); await wait(300);
  t = await tail(before);
  check('success: Sanctuary Breached announced', t.includes('Sanctuary Breached'), t.slice(0, 140));
  const st = (await D(() => window.rpgCustodianDebug.statuses('Marta'))).find(s => s.name === 'Sanctuary Breached');
  check('status carries +10 fertility', st?.mods?.[0]?.stat === 'fertility' && st.mods[0].amount === 10, JSON.stringify(st?.mods));
  check('status lasts 2 time periods', await D(() => { const s = window.rpgCustodianDebug.statuses('Marta').find(x => x.name === 'Sanctuary Breached'); return s.expiresStep - (window.rpgCustodianDebug.state().timeStep || 0) === 2; }));
  check('her effective fertility rose by 10', (await D(() => window.rpgCustodianDebug.fertilityOf('Marta'))) - fertBefore === 10);
  note = await D(() => window.rpgCustodianDebug.statusNote('Marta'));
  check('her reply note demands the on-the-spot climax', /climax|comes/.test(note) && /womb|cervix/.test(note), note.slice(0, 100));
  check('the breach-climax spent her stamina', (await D(() => window.rpgCustodianDebug.rel('Marta').npcStamina)) === 0);

  // ── inert while the status holds ──
  before = await chatLen();
  await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });
  await D(() => window.rpgCustodianDebug.cervixPress('Marta')); await wait(300);
  check('repeat press is mechanically inert', (await chatLen()) === before && !(await D(() => window.rpgCustodianDebug.statusNote('Marta'))));
  await D(() => window.rpgCustodianDebug.removeStatus('Marta', 'Sanctuary Breached'));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Test Might'));
  await D(() => window.rpgCustodianDebug.heal('Marta', 'full'));

  // ── Custodian judgment (cheap model, majority of 3) ──
  const RUNS = 3;
  for (const [label, want, text] of [
    ['womb-seeking press', true, 'I bury myself to the hilt inside her and grind the head of my cock hard against her cervix, trying to force my way into her womb itself.'],
    ['pressing as deep as possible', true, 'I press as deep into her as her body will possibly let me, straining against her deepest limit.'],
    ['ordinary deep thrusting', false, 'I thrust into her steadily, losing myself in her warmth.'],
  ]) {
    let hit = 0, died = 0;
    for (let r = 0; r < RUNS; r++) {
      const res = await D(async (t) => {
        const i = await window.rpgCustodianDebug.analyze(t);
        return { died: !i || i.analyzerFailed, has: [...(i?.effects_on_success || []), ...(i?.effects_on_failure || [])].some(e => e.type === 'cervix_press') };
      }, text);
      if (res.died) { died++; continue; }
      if (res.has === want) hit++;
    }
    check(`${label} → cervix_press ${want ? 'emitted' : 'NOT emitted'}`, hit > (RUNS - died) / 2, `${hit}/${RUNS - died}${died ? ` (died ${died}x)` : ''}`);
  }

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
