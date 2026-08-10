// Her cycle as her body tells it: outright knowledge + unmistakable signs at
// the two extremes, softer signs on the shoulder days, silence mid-cycle.
// Affection gates whether she VOLUNTEERS it, never whether she knows it.
import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A bold adventurer.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };

// Put the NPC on a specific cycle step by picking the day, then read her line.
const lineAtStep = async (npc, step) => {
  const day = await D((n, s) => { for (let d = 1; d <= 8; d++) if (window.rpgCustodianDebug.cycle(n, d).step === s) return d; return null; }, npc, step);
  await D((d) => { window.rpgCustodianDebug.state().dayCount = d; }, day);
  return D((n) => window.rpgCustodianDebug.cycleLine(n), npc);
};

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

  const npc = 'Marta';
  await D((n) => window.rpgCustodianDebug.setAffection(n, 9), npc);

  let l = await lineAtStep(npc, 4);
  check('ovulation day: outright, with heat/flush/scent', l.includes('OVULATING today') && l.includes('warmth') && l.includes('flush low across her belly') && l.includes('scent'), l.slice(0, 90));
  check('ovulation day: no share-gate at affection 9', !l.includes('would not volunteer'));
  l = await lineAtStep(npc, 3);
  check('day before: fertile window opening', l.includes('fertile window has opened') && l.includes('sweeten'));
  l = await lineAtStep(npc, 5);
  check('day after: window closing, could still get pregnant', l.includes('ovulated yesterday') && l.includes('get pregnant'));
  l = await lineAtStep(npc, 0);
  check('period day: outright, with cramps', l.includes('period has come') && l.includes('cramps') && l.includes('cannot conceive'));
  l = await lineAtStep(npc, 7);
  check('day before period: twinges starting', l.includes('period is due tomorrow') && l.includes('twinges'));
  l = await lineAtStep(npc, 1);
  check('day after period: winding down', l.includes('period is just winding down') && l.includes('fading'));
  l = await lineAtStep(npc, 2);
  check('mid-cycle day says nothing', l === '');
  l = await lineAtStep(npc, 6);
  check('other mid-cycle day says nothing', l === '');

  // No game abstraction anywhere she can quote it: sweep every step.
  let leaks = [];
  for (let st = 0; st < 8; st++) {
    const line = await lineAtStep(npc, st);
    // Game terms, register meta-instructions ("speaks as a woman"), and
    // vocabulary nobody uses ("catch" for conceiving) — all leak into dialogue.
    if (/\b(moon|peak|ebb|catch)\b|speaks as a woman|🌑|🌒|🌓|🌔|🌕|🌖|🌗|🌘|%/i.test(line)) leaks.push(`step ${st}: ${line.slice(0, 60)}`);
  }
  check('no game terms, register meta, or "catch" on any NPC-facing line', leaks.length === 0, leaks.join(' | '));

  // Guarded (affection ≤4): she still KNOWS — the gate is on volunteering.
  await D((n) => window.rpgCustodianDebug.setAffection(n, 2), npc);
  l = await lineAtStep(npc, 4);
  check('guarded ovulation: knowledge kept, sharing gated', l.includes('OVULATING today') && l.includes('would not volunteer') && l.includes('never claim ignorance'));

  // The line lands in the live status block she actually reads.
  await D((n) => window.rpgCustodianDebug.setAffection(n, 9), npc);
  await lineAtStep(npc, 4);
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);
  const status = await D(() => window.rpgCustodianDebug.statusText());
  check('ovulation line reaches the status block', status.includes('HER CYCLE — she is OVULATING'));

  // Pregnancy silences the cycle talk in the block.
  await D((n) => window.rpgCustodianDebug.setPreg(n, 1, 30), npc);
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);
  const status2 = await D(() => window.rpgCustodianDebug.statusText());
  check('pregnancy suppresses the cycle line', !status2.includes('HER CYCLE'));
  await D((n) => window.rpgCustodianDebug.setPreg(n, 0, 0), npc);

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
