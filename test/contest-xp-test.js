// Won contests pay XP like any won check (Dyna 2026-08-13): cervix press,
// belly massage, holding out against a milking, landing your own curse, and
// shrugging off a hex aimed at you. Losses and her wins pay nothing.
import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A bold adventurer.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };
const xp = () => D(() => window.rpgCustodianDebug.xp());
const chatLen = () => D(() => SillyTavern.getContext().chat.length);
const tail = (n) => D((n) => SillyTavern.getContext().chat.slice(n).map(m => m.mes).join('\n'), n);
const clearMarta = () => D(() => { ['Sanctuary Breached', 'Stimulated Ovaries'].forEach(s => window.rpgCustodianDebug.removeStatus('Marta', s)); const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);
  const eff = await D(() => { const c = window.rpgCustodianDebug.rollCheck('ruggedness', 8); return c.eff; });
  const cEff = await D(() => { const c = window.rpgCustodianDebug.rollCheck('craftiness', 8); return c.eff; });

  // Cervix press: won → paid, lost → nothing.
  await clearMarta();
  await D((amt) => window.rpgCustodianDebug.buff('player', 'ruggedness', amt, 'T-Rug'), 12 - eff);
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 1; });
  let before = await xp(); let bLen = await chatLen();
  await D(() => window.rpgCustodianDebug.cervixPress('Marta')); await wait(300);
  check('breach success pays XP', (await xp()) > before && (await tail(bLen)).includes('✨ +'), `+${(await xp()) - before}`);
  await clearMarta();
  await D(() => window.rpgCustodianDebug.heal('Marta', 'full'));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'T-Rug'));
  await D((amt) => window.rpgCustodianDebug.buff('player', 'ruggedness', amt, 'T-Sap'), 0 - eff);
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 12; });
  before = await xp();
  await D(() => window.rpgCustodianDebug.cervixPress('Marta')); await wait(300);
  check('a failed press pays nothing', (await xp()) === before);
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'T-Sap'));
  await clearMarta();

  // Belly massage success.
  await D((amt) => window.rpgCustodianDebug.buff('player', 'craftiness', amt, 'T-Craft'), 12 - cEff);
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 1; });
  before = await xp(); bLen = await chatLen();
  await D(() => window.rpgCustodianDebug.bellyMassage('Marta')); await wait(300);
  check('belly massage success pays XP', (await xp()) > before && (await tail(bLen)).includes('✨ +'));
  await clearMarta();

  // Milk hold: his win pays; her win pays nothing extra beyond conception XP (not tested here).
  await D(() => window.rpgCustodianDebug.heal('player', 'full'));
  await D(() => window.rpgCustodianDebug.buff('player', 'stamina', 8, 'T-Bulwark'));
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 0; });
  before = await xp(); bLen = await chatLen();
  await D(() => window.rpgCustodianDebug.milk('Marta', 'vaginal')); await wait(1500);
  check('holding out against her pays XP', (await xp()) > before && (await tail(bLen)).includes('he holds'), `+${(await xp()) - before}`);
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'T-Bulwark'));
  await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });

  // Player-cast curse: landing it pays; failing pays nothing.
  before = await xp(); bLen = await chatLen();
  await D(() => window.rpgCustodianDebug.castCurse({ target: 'Marta' }));   // T-Craft still on: attack 12 vs DC 8+her rug
  await wait(300);
  check('landing your own curse pays XP', (await D(() => window.rpgCustodianDebug.isCursed('Marta'))) && (await xp()) > before && (await tail(bLen)).includes('✨ +'));
  await D(() => window.rpgCustodianDebug.uncurse('Marta'));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'T-Craft'));
  await D((amt) => window.rpgCustodianDebug.buff('player', 'craftiness', amt, 'T-Dull'), -4 - cEff);
  before = await xp();
  await D(() => window.rpgCustodianDebug.castCurse({ target: 'Marta' })); await wait(300);
  check('a failed casting pays nothing', !(await D(() => window.rpgCustodianDebug.isCursed('Marta'))) && (await xp()) === before);
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'T-Dull'));

  // Being hexed and shrugging it off pays.
  before = await xp(); bLen = await chatLen();
  await D(() => window.rpgCustodianDebug.castCurse({ target: 'player', power: -5 }));   // max roll 7 vs DC ≥ 11 — guaranteed resist
  await wait(300);
  check('resisting a hex aimed at you pays XP', !(await D(() => window.rpgCustodianDebug.isCursed('player'))) && (await xp()) > before && (await tail(bLen)).includes('RESISTED'));

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
