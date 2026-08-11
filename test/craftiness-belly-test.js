// belly_massage: Craftiness contest vs DC 7 + her remaining Stamina →
// Stimulated Ovaries on success, a nice massage on a miss, inert while she
// already bears it. Plus the widened Craftiness doctrine (INT+PER+DEX):
// locks, sleight of hand, and searching for hidden things must roll craft.
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
const clearNotes = () => D(() => { const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);

  // ── Forced MISS (her stamina 10 → DC 17; his effective craft 0 → max 15) ──
  const eff = await D(() => { const c = window.rpgCustodianDebug.rollCheck('craftiness', 8); return c.eff; });
  await D((amt) => window.rpgCustodianDebug.buff('player', 'craftiness', amt, 'Test Fumble Fingers'), 0 - eff);
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 10; });
  let before = await chatLen();
  await D(() => window.rpgCustodianDebug.bellyMassage('Marta')); await wait(300);
  let t = await tail(before);
  check('miss: it stays a pleasant kneading', t.includes('A pleasant kneading, no more'), t.slice(0, 130));
  check('miss: craftiness check at DC 7 + her stamina', t.includes('craftiness check') && t.includes('DC 17'));
  check('miss: no status landed', !(await D(() => window.rpgCustodianDebug.statuses('Marta'))).some(s => s.name === 'Stimulated Ovaries'));
  let note = await D(() => window.rpgCustodianDebug.statusNote('Marta'));
  check('miss: her note is skin-deep comfort, never failure', /skin-deep/.test(note) && !/fail/i.test(note), note.slice(0, 90));
  check('miss: the roll wears the red tint', await D(() => { const chat = SillyTavern.getContext().chat; const i = chat.findLastIndex(m => m.extra?.rpg_adversarial); return i >= 0 && (chat[i].mes || '').includes('Knowing hands'); }));
  await clearNotes();
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Test Fumble Fingers'));

  // ── Forced SUCCESS (her stamina 1 → DC 8; his effective craft 12 → min 11) ──
  await D((amt) => window.rpgCustodianDebug.buff('player', 'craftiness', amt, 'Test Golden Hands'), 12 - eff);
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 1; });
  const fertBefore = await D(() => window.rpgCustodianDebug.fertilityOf('Marta'));
  before = await chatLen();
  await D(() => window.rpgCustodianDebug.bellyMassage('Marta')); await wait(300);
  t = await tail(before);
  check('success: Stimulated Ovaries takes hold', t.includes('Stimulated Ovaries'), t.slice(0, 140));
  const st = (await D(() => window.rpgCustodianDebug.statuses('Marta'))).find(s => s.name === 'Stimulated Ovaries');
  check('status carries +10 fertility for 1 period', st?.mods?.[0]?.amount === 10 && await D(() => { const s = window.rpgCustodianDebug.statuses('Marta').find(x => x.name === 'Stimulated Ovaries'); return s.expiresStep - (window.rpgCustodianDebug.state().timeStep || 0) === 1; }));
  check('her effective fertility rose by 10', (await D(() => window.rpgCustodianDebug.fertilityOf('Marta'))) - fertBefore === 10);
  note = await D(() => window.rpgCustodianDebug.statusNote('Marta'));
  check('her note plays the deep stirring', /roused|fluttering/.test(note), note.slice(0, 90));

  // ── Inert while the status holds ──
  await clearNotes();
  before = await chatLen();
  await D(() => window.rpgCustodianDebug.bellyMassage('Marta')); await wait(300);
  check('repeat massage is mechanically inert', (await chatLen()) === before && !(await D(() => window.rpgCustodianDebug.statusNote('Marta'))));
  await D(() => window.rpgCustodianDebug.removeStatus('Marta', 'Stimulated Ovaries'));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Test Golden Hands'));
  await D(() => window.rpgCustodianDebug.heal('Marta', 'full'));

  // ── Custodian judgment ──
  const RUNS = 3;
  const probe = async (text, judge) => {
    let hit = 0, died = 0;
    for (let r = 0; r < RUNS; r++) {
      const res = await D(async (t) => {
        const i = await window.rpgCustodianDebug.analyze(t);
        if (!i || i.analyzerFailed) return { died: true };
        return { died: false, stat: i?.check?.stat || null, effects: [...(i?.effects_on_success || []), ...(i?.effects_on_failure || [])].map(e => e.type) };
      }, text);
      if (res.died) { died++; continue; }
      if (judge(res)) hit++;
    }
    return { hit, died };
  };

  let r = await probe('I lay my palms low on her belly and knead slow, deep circles down over her womb, working to wake her ovaries.', (res) => res.effects.includes('belly_massage'));
  check('deliberate womb massage → belly_massage', r.hit > (RUNS - r.died) / 2, `${r.hit}/${RUNS - r.died}${r.died ? ` (died ${r.died}x)` : ''}`);
  r = await probe('I rest a hand gently on her belly as we lie together, saying nothing.', (res) => !res.effects.includes('belly_massage'));
  check('a resting hand → NOT belly_massage', r.hit > (RUNS - r.died) / 2, `${r.hit}/${RUNS - r.died}${r.died ? ` (died ${r.died}x)` : ''}`);

  // Craftiness scope: locks, sleight of hand, hidden things all roll craft.
  r = await probe('I kneel at the cellar door and work the lock with a bent pin, feeling for the tumblers.', (res) => res.stat === 'craftiness');
  check('picking a lock → craftiness check', r.hit > (RUNS - r.died) / 2, `${r.hit}/${RUNS - r.died}${r.died ? ` (died ${r.died}x)` : ''}`);
  r = await probe('I flourish my hand and produce a silver coin from behind Marta\'s ear, grinning at her.', (res) => res.stat === 'craftiness');
  check('sleight of hand to impress her → craftiness check', r.hit > (RUNS - r.died) / 2, `${r.hit}/${RUNS - r.died}${r.died ? ` (died ${r.died}x)` : ''}`);
  r = await probe('I run my fingers along the cold rockface, searching methodically for the hidden entrance I am sure is here.', (res) => res.stat === 'craftiness');
  check('searching for a hidden entrance → craftiness check', r.hit > (RUNS - r.died) / 2, `${r.hit}/${RUNS - r.died}${r.died ? ` (died ${r.died}x)` : ''}`);

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
