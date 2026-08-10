// The GM must never narrate over a woman who is about to answer a charm ask.
// The reply loop and the narration gate now share ONE resolver
// (resolveReplyTargets); the live bug was the gate keying on detectAddressedNpcs
// alone, which comes up empty when a mid-conversation ask drops her name.
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
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);

  // Named ask: she is the target.
  let r = await D(() => window.rpgCustodianDebug.replyTargets('"Marta, would you ever run away with me?"', { check: { stat: 'charm' } }));
  check('named ask targets her', r.targets.length === 1 && r.targets[0] === 'Marta', JSON.stringify(r));

  // THE LIVE BUG: mid-conversation ask, no name — she holds the floor.
  await D(() => { window.rpgCustodianDebug.state().lastReplier = 'Marta'; });
  r = await D(() => window.rpgCustodianDebug.replyTargets('"Say... would you ever fancy settling down with someone like me?"', { check: { stat: 'charm' } }));
  check('unnamed mid-conversation ask still finds the floor-holder', r.targets.length === 1 && r.targets[0] === 'Marta', JSON.stringify(r));
  check('…even though no name was detected', r.addressed.length === 0);

  // Analyzer's target guess fills the gap when nobody holds the floor.
  await D(() => { window.rpgCustodianDebug.state().lastReplier = null; });
  r = await D(() => window.rpgCustodianDebug.replyTargets('"Would you pour me another?"', { target_npc: 'Marta' }));
  check('analyzer target used when nobody holds the floor', r.targets.length === 1 && r.targets[0] === 'Marta', JSON.stringify(r));

  // A floor-holder who LEFT (or sleeps) is not a target — GM may speak then.
  await D(() => { window.rpgCustodianDebug.state().lastReplier = 'Fern'; });   // Fern is not at the inn
  r = await D(() => window.rpgCustodianDebug.replyTargets('"Anyone happen to know the way to the springs?"', {}));
  check('an absent floor-holder resolves to nobody', r.targets.length === 0, JSON.stringify(r));

  // Unconscious floor-holder likewise.
  await D(() => { window.rpgCustodianDebug.state().lastReplier = 'Marta'; window.rpgCustodianDebug.rel('Marta').npcUnconscious = true; });
  r = await D(() => window.rpgCustodianDebug.replyTargets('"...you alright?"', {}));
  check('an unconscious floor-holder resolves to nobody', r.targets.length === 0, JSON.stringify(r));
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcUnconscious = false; });

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
