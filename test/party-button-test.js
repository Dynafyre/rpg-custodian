// Party management button: join / disband-stays / disband-to-routine, all
// silent — no GM narration, no NPC farewell (the NL path keeps those). Also a
// mobile-viewport popup-position pass.
import { connect, login, useMobileViewport } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A bold adventurer.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };

const chatLen = () => D(() => SillyTavern.getContext().chat.length);
// Non-system additions = narration (GM prose or an NPC farewell). Ghost logs are is_system.
const narrationSince = (n) => D((n) => SillyTavern.getContext().chat.slice(n).filter(m => !m.is_system).map(m => `${m.name}: ${(m.mes || '').slice(0, 80)}`), n);
const clickBar = (text) => D((t) => { const b = [...document.querySelectorAll('.rpg-action-btn')].find(b => b.textContent.includes(t)); if (!b) return false; b.click(); return true; }, text);
const clickRow = (text) => D((t) => { const r = [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(r => r.textContent.includes(t)); if (!r) return false; r.click(); return true; }, text);

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

  // Find a location with somebody home and go there.
  const found = await D(() => {
    const dbg = window.rpgCustodianDebug;
    for (const loc of Object.keys(dbg.state().worldData.locations)) {
      const p = dbg.presence(loc);
      if (p.length) return { loc, npc: p[0] };
    }
    return null;
  });
  if (!found) throw new Error('no NPC found anywhere in the world');
  await D((l) => window.rpgCustodianDebug.teleport(l), found.loc); await wait(800);
  const npc = found.npc;
  console.log(`Using ${npc} at ${found.loc}`);

  // ── Join via button ──
  let before = await chatLen();
  check('Party button shown with joinable NPC present', await clickBar('Party')); await wait(300);
  check(`popup offers "${npc} joins the party"`, await clickRow('joins the party')); await wait(1200);
  check('joined the party', await D((n) => window.rpgCustodianDebug.state().party.includes(n), npc));
  let narr = await narrationSince(before);
  check('join produced no narration', narr.length === 0, narr.join(' | '));
  check('bar shows party count', await D(() => [...document.querySelectorAll('.rpg-action-btn')].some(b => b.textContent.includes('Party (1)'))));

  // ── Disband, she stays here ──
  before = await chatLen();
  await clickBar('Party'); await wait(300);
  check('popup offers "she stays here"', await clickRow('she stays here')); await wait(1500);
  check('left the party', await D((n) => !window.rpgCustodianDebug.state().party.includes(n), npc));
  check('lingering pin set here', await D((n, l) => window.rpgCustodianDebug.rel(n).partedAt === l, npc, found.loc));
  check('still present here', (await D(() => window.rpgCustodianDebug.presence())).includes(npc));
  narr = await narrationSince(before);
  check('quiet disband produced no narration/farewell', narr.length === 0, narr.join(' | '));

  // ── Disband back to her routine (from a spot that is not her scheduled one) ──
  await D((n) => window.rpgCustodianDebug.addParty(n), npc); await wait(800);
  const away = await D((n) => {
    const dbg = window.rpgCustodianDebug;
    const sched = () => dbg.slot(n).loc;
    for (const loc of Object.keys(dbg.state().worldData.locations)) if (loc !== sched()) return loc;
    return null;
  }, npc);
  await D((l) => window.rpgCustodianDebug.teleport(l), away); await wait(800);
  check('party member travelled with player', (await D(() => window.rpgCustodianDebug.presence())).includes(npc));
  before = await chatLen();
  await clickBar('Party'); await wait(300);
  check('popup offers "back to her routine"', await clickRow('back to her routine')); await wait(1500);
  check('left the party', await D((n) => !window.rpgCustodianDebug.state().party.includes(n), npc));
  check('no lingering pin', await D((n) => !window.rpgCustodianDebug.rel(n).partedAt, npc));
  check('gone from here', !(await D(() => window.rpgCustodianDebug.presence())).includes(npc));
  const schedLoc = await D((n) => window.rpgCustodianDebug.slot(n).loc, npc);
  check('present at her scheduled spot', (await D((l) => window.rpgCustodianDebug.presence(l), schedLoc)).includes(npc), `${schedLoc}`);
  narr = await narrationSince(before);
  check('routine disband produced no narration/farewell', narr.length === 0, narr.join(' | '));

  // ── Mobile pass on a fresh page: tap the button, popup must land on-screen ──
  const mob = await browser.newPage();
  const M = (fn, ...a) => mob.evaluate(fn, ...a);
  try {
    await useMobileViewport(mob);
    await login(mob);
    await mob.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await M((w) => window.rpgCustodianDebug.continueGame(w), 'prototype-town'); await wait(15000);
    // Stand where somebody is, so the Party button has candidates.
    await M((n) => window.rpgCustodianDebug.teleport(window.rpgCustodianDebug.slot(n).loc), npc); await wait(800);
    const btn = await M(() => { const b = [...document.querySelectorAll('.rpg-action-btn')].find(b => b.textContent.includes('Party')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    check('mobile: Party button rendered', !!btn);
    if (btn) {
      await mob.touchscreen.tap(btn.x, btn.y); await wait(500);
      const rect = await M(() => { const el = document.getElementById('rpg-action-popup'); if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: window.innerWidth, h: window.innerHeight }; });
      check('mobile: popup opens on tap', !!rect);
      if (rect) check('mobile: popup fully on-screen', rect.l >= 0 && rect.t >= 0 && rect.r <= rect.w && rect.b <= rect.h, JSON.stringify(rect));
      const row = await M(() => { const r = [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(r => r.textContent.includes('joins the party')); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      check('mobile: join row offered', !!row);
      if (row) {
        await mob.touchscreen.tap(row.x, row.y); await wait(1200);
        check('mobile: tap joins the party', await M((n) => window.rpgCustodianDebug.state().party.includes(n), npc));
        await M((n) => window.rpgCustodianDebug.removeParty(n, { quiet: true, resumeSchedule: true }), npc); await wait(800);
      }
    }
  } finally { await mob.close(); }

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
