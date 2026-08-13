// Story revival is REAL now: removing the engine-derived Unconscious status
// (judge or Custodian) wakes her with 1 Stamina + Utterly Spent, pins her
// here for the period so she can walk herself home, and the status cannot
// resurrect on the next sync. Player Exhausted gets the same derived-state
// fix (splash of water → Stamina 1).
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
const martaStatuses = () => D(() => window.rpgCustodianDebug.statuses('Marta').map(s => s.name));

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);

  // Fell her, and let the engine derive her Unconscious status.
  await D(() => window.rpgCustodianDebug.hurt('Marta', 99));
  await D(() => window.rpgCustodianDebug.statusText());   // forces a sync
  check('KO derives the Unconscious status', (await martaStatuses()).includes('Unconscious'));

  // The live repro: the judge ends it ("revived by splash of water").
  let before = await chatLen();
  await D(() => window.rpgCustodianDebug.removeStatus('Marta', 'Unconscious', 'revived by splash of water'));
  await wait(300);
  const t = await tail(before);
  check('the revival announces itself', t.includes('comes to') && t.includes('Utterly Spent'), t.slice(0, 160));
  check('she is actually awake', !(await D(() => window.rpgCustodianDebug.rel('Marta').npcUnconscious)));
  check('with exactly 1 Stamina', (await D(() => window.rpgCustodianDebug.rel('Marta').npcStamina)) === 1);
  check('Utterly Spent replaces Unconscious', (await martaStatuses()).includes('Utterly Spent'));
  check('the revival pin holds her here', await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); return r.partedAt != null && r.partedStep === (window.rpgCustodianDebug.state().timeStep || 0) && !r.stashedAt; }));
  check('an unsung swan song is cleared', !(await D(() => window.rpgCustodianDebug.rel('Marta').koReplyOwed)));
  check('her groggy reaction is queued', /brought around|wrung out/.test(await D(() => window.rpgCustodianDebug.statusNote('Marta'))));

  // THE resurrection bug: the next sync must NOT re-derive Unconscious.
  await D(() => window.rpgCustodianDebug.statusText());
  check('Unconscious does NOT resurrect on the next sync', !(await martaStatuses()).includes('Unconscious'));

  // Time moves on: the pin expires — she is free to walk herself home.
  await D(() => window.rpgCustodianDebug.tick(1)); await wait(600);
  check('the pin expires with the period', await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); return r.partedStep !== (window.rpgCustodianDebug.state().timeStep || 0); }));
  check('she stands at her own scheduled spot', await D(() => { const loc = window.rpgCustodianDebug.slot('Marta').loc; return window.rpgCustodianDebug.presence(loc).includes('Marta'); }));
  await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });
  await D(() => window.rpgCustodianDebug.removeStatus('Marta', 'Utterly Spent'));
  await D(() => window.rpgCustodianDebug.heal('Marta', 'full'));

  // Player parity: story-ending Exhausted actually revives him.
  await D(() => window.rpgCustodianDebug.hurt('player', 99));
  await D(() => window.rpgCustodianDebug.statusText());
  check('player at 0 derives Exhausted', (await D(() => window.rpgCustodianDebug.statuses('player').map(s => s.name))).includes('Exhausted'));
  before = await chatLen();
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Exhausted', 'a splash of cold water'));
  await wait(300);
  check('he comes back to himself at 1 Stamina', (await D(() => window.rpgCustodianDebug.stamina())) === 1 && (await tail(before)).includes('come back to yourself'));
  await D(() => window.rpgCustodianDebug.statusText());
  check('Exhausted does not resurrect either', !(await D(() => window.rpgCustodianDebug.statuses('player').map(s => s.name))).includes('Exhausted'));
  await D(() => window.rpgCustodianDebug.heal('player', 'full'));

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
