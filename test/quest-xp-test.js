// Every quest pays a flat 200 XP — engine-owned, whatever the Custodian
// suggested (a live quest paid 5 XP). Normalized at creation so displays
// tell the truth, enforced again at completion for legacy saves.
import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A bold adventurer.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

  // A stingy model reward gets normalized to 200 at creation, gold untouched.
  await D(() => window.rpgCustodianDebug.addObjective({ name: 'Sweep the stables', end_condition: 'the stables are swept', reward: { gold: 5, xp: 5 } }));
  let q = (await D(() => window.rpgCustodianDebug.objectives())).find(o => o.name === 'Sweep the stables');
  check('xp normalized to 200 on the record', q?.reward?.xp === 200, JSON.stringify(q?.reward));
  check('gold flavor preserved', q?.reward?.gold === 5);

  let before = await D(() => window.rpgCustodianDebug.xp());
  await D(() => window.rpgCustodianDebug.completeQuest('Sweep the stables')); await wait(300);
  let after = await D(() => window.rpgCustodianDebug.xp());
  check('completion pays exactly 200 XP', after - before === 200, `${before} → ${after}`);

  // A quest with NO reward at all still pays 200.
  await D(() => window.rpgCustodianDebug.addObjective({ name: 'Walk the walls', end_condition: 'the walls are walked' }));
  q = (await D(() => window.rpgCustodianDebug.objectives())).find(o => o.name === 'Walk the walls');
  check('rewardless quest gets xp 200 stamped', q?.reward?.xp === 200, JSON.stringify(q?.reward));
  before = after;
  await D(() => window.rpgCustodianDebug.completeQuest('Walk the walls')); await wait(300);
  after = await D(() => window.rpgCustodianDebug.xp());
  check('rewardless completion still pays 200 XP', after - before === 200, `${before} → ${after}`);

  // Legacy record (predates normalization): create one, then rewrite its
  // reward back to the old stingy shape in-page before completing it.
  await D(() => window.rpgCustodianDebug.addObjective({ name: 'Old ledger errand', end_condition: 'done' }));
  await D(() => { const e = window.rpgCustodianDebug.objectives().find(o => o.name === 'Old ledger errand'); e.reward = { xp: 5 }; });
  before = after;
  await D(() => window.rpgCustodianDebug.completeQuest('Old ledger errand')); await wait(300);
  after = await D(() => window.rpgCustodianDebug.xp());
  check('legacy 5-XP quest pays 200 at completion', after - before === 200, `${before} → ${after}`);

  // Ordinary statuses are untouched by the stamp.
  await D(() => window.rpgCustodianDebug.buff('player', 'charm', 1, 'Plain Tonic'));
  const st = (await D(() => window.rpgCustodianDebug.statuses('player'))).find(s => s.name === 'Plain Tonic');
  check('non-quest status gets no reward stamped', !st?.reward, JSON.stringify(st?.reward));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Plain Tonic'));

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
