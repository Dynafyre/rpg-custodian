// A status is "freshly taken hold" for exactly ONE turn. The live bug:
// duration-only statuses (no endCondition) never shed justCreated, so the
// GM narrated Milked Dry "settling in" at every single beat of the scene.
import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A bold adventurer.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };
const idle = async (max = 60) => { for (let i = 0; i < max; i++) { await wait(2000); if (!(await D(() => window.rpgCustodianDebug.busy()))) break; } await wait(1500); };
const act = async (t) => { await D((t) => window.rpgCustodianDebug.act(t), t); await idle(); };
const flagOf = (name) => D((n) => window.rpgCustodianDebug.statuses('player').find(s => s.name === n)?.justCreated, name);

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);

  // The live shape: a DURATION-ONLY status (no endCondition), like Milked Dry.
  await D(() => window.rpgCustodianDebug.addStatus('player', { name: 'Test Ache', kind: 'debuff', polarity: 'negative', desc: 'a deep hollow ache', duration: 6 }));
  check('a fresh duration-only status is flagged', (await flagOf('Test Ache')) === true);
  await act('"Marta, a lovely morning, is it not?"');
  check('one turn later the freshness is SHED', (await flagOf('Test Ache')) === false, `flag: ${await flagOf('Test Ache')}`);

  // An endCondition status behaves the same (the path that always worked).
  await D(() => window.rpgCustodianDebug.addStatus('player', { name: 'Test Vow', kind: 'vow', desc: 'sworn', end_condition: 'the vow is fulfilled' }));
  check('a fresh judged status is flagged', (await flagOf('Test Vow')) === true);
  await act('"And the bread smells fine today."');
  check('it sheds freshness after one turn too', (await flagOf('Test Vow')) === false);

  // A PERMANENT curse (no break condition) must shed its freshness as well.
  const curseFlag = () => D(() => window.rpgCustodianDebug.curseState('player')?.justCreated);
  await D(() => window.rpgCustodianDebug.curse('player'));
  check('a fresh permanent curse is flagged', (await D(() => window.rpgCustodianDebug.isCursed('player'))) && (await curseFlag()) === true);
  await act('"Pay me no mind, just thinking aloud."');
  check('the permanent curse sheds freshness after one turn', (await curseFlag()) === false);
  await D(() => window.rpgCustodianDebug.uncurse('player'));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Test Ache'));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Test Vow'));

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
