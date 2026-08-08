// Arousal decay is 3/period (was 2, Dyna 2026-08-08), and a gain that changes
// nothing she plays — already 10/10, or pinned by a cap — prints no ghost line.
import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A bold adventurer.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };

const chatLen = () => D(() => SillyTavern.getContext().chat.length);
const arousalLinesSince = (n) => D((n) => SillyTavern.getContext().chat.slice(n).filter(m => (m.mes || '').includes('🔥 arousal')).map(m => m.mes), n);

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

  const npc = await D(() => window.rpgCustodianDebug.presence()[0]) ||
    (await D(() => { const dbg = window.rpgCustodianDebug; for (const l of Object.keys(dbg.state().worldData.locations)) { const p = dbg.presence(l); if (p.length) return p[0]; } return null; }));
  if (!npc) throw new Error('no NPC found');
  console.log(`Using ${npc}`);

  // ── Decay: 3 per period, floored at 0 ──
  await D((n) => window.rpgCustodianDebug.setArousal(n, 10), npc);
  await D(() => window.rpgCustodianDebug.tick(1)); await wait(600);
  check('one period: 10 → 7', await D((n) => window.rpgCustodianDebug.rel(n).arousal, npc) === 7);
  await D(() => window.rpgCustodianDebug.tick(1)); await wait(600);
  check('two periods: 7 → 4', await D((n) => window.rpgCustodianDebug.rel(n).arousal, npc) === 4);
  await D((n) => window.rpgCustodianDebug.setArousal(n, 2), npc);
  await D(() => window.rpgCustodianDebug.tick(1)); await wait(600);
  check('decay floors at 0 (from 2)', await D((n) => window.rpgCustodianDebug.rel(n).arousal, npc) === 0);

  // ── adjust_arousal message: shown while rising, silent at full ──
  await D((n) => window.rpgCustodianDebug.setArousal(n, 8), npc);
  let before = await chatLen();
  await D((n) => window.rpgCustodianDebug.applyEffects({ type: 'adjust_arousal', npc: n, amount: 2 }), npc); await wait(400);
  let lines = await arousalLinesSince(before);
  check('8 → 10 gain still prints', lines.length === 1, lines.join(' | '));
  check('arousal is now 10', await D((n) => window.rpgCustodianDebug.npcEff(n).aro, npc) === 10);

  before = await chatLen();
  await D((n) => window.rpgCustodianDebug.applyEffects({ type: 'adjust_arousal', npc: n, amount: 1 }), npc); await wait(400);
  lines = await arousalLinesSince(before);
  check('gain at full 10/10 prints NOTHING', lines.length === 0, lines.join(' | '));

  before = await chatLen();
  await D((n) => window.rpgCustodianDebug.applyEffects({ type: 'adjust_arousal', npc: n, amount: -3 }), npc); await wait(400);
  lines = await arousalLinesSince(before);
  check('a drop from full still prints', lines.length === 1, lines.join(' | '));

  // ── Pinned by a status cap: a gain that cannot show is silent too ──
  await D((n) => window.rpgCustodianDebug.setArousal(n, 3), npc);
  await D((n) => window.rpgCustodianDebug.addStatus(n, { name: 'Chastity Ward', kind: 'debuff', polarity: 'negative', mods: [{ stat: 'arousal', cap: 3 }], duration: 4 }), npc); await wait(400);
  before = await chatLen();
  await D((n) => window.rpgCustodianDebug.applyEffects({ type: 'adjust_arousal', npc: n, amount: 2 }), npc); await wait(400);
  lines = await arousalLinesSince(before);
  check('gain pinned at cap prints NOTHING', lines.length === 0, lines.join(' | '));
  await D((n) => window.rpgCustodianDebug.removeStatus(n, 'Chastity Ward'), npc);

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
