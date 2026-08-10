// The RPG "clock" button menu is now the single home of the game verbs — the
// bottom action bar is gone (2026-08-05). This drives the flattened menu:
// structure (verbs in, Character Sheet / Date & Time rows out, date lives in
// the header), and the narration-free party management rows (join /
// disband-stays / disband-to-routine). Mobile tap pass included.
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
const openMenu = async () => { await D(() => { $('#rpg-menu-popup').remove(); $('#rpg-action-popup').remove(); }); await page.click('#rpg-menu-button'); await wait(300); };
const menuRows = () => D(() => [...document.querySelectorAll('#rpg-menu-popup .rpg-menu-item')].map(r => r.textContent.trim()));
const menuHeader = () => D(() => document.querySelector('#rpg-menu-popup .rpg-popup-title')?.textContent || '');
const clickMenuRow = (text) => D((t) => { const r = [...document.querySelectorAll('#rpg-menu-popup .rpg-menu-item')].find(r => r.textContent.includes(t)); if (!r) return false; r.click(); return true; }, text);
const clickPopupRow = (text) => D((t) => { const r = [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(r => r.textContent.includes(t)); if (!r) return false; r.click(); return true; }, text);

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

  // ── The flattened menu, in play ──
  check('action bar is gone', await D(() => !document.getElementById('rpg-action-bar')));
  await openMenu();
  let rows = await menuRows();
  const has = (t) => rows.some(r => r.includes(t));
  check('menu has the game verbs', has('Move') && has('Look') && has('Items') && has('Wait'), rows.join(' | '));
  check('menu has session actions', has('Worlds') && has('Edit Character') && has('Exit RPG Mode'));
  check('Character Sheet row removed', !has('Character Sheet'));
  check('Date & Time row removed', !has('Date & Time'));
  const header = await menuHeader();
  check('date/time lives in the header', /Day \d/.test(header), header);
  check('menu has separators', await D(() => document.querySelectorAll('#rpg-menu-popup .rpg-menu-sep').length >= 2));

  // ── Sub-popups open from the menu ──
  check('Move row opens travel popup', await clickMenuRow('Move')); await wait(400);
  check('travel popup lists a destination', await D(() => document.querySelectorAll('#rpg-action-popup .rpg-menu-item').length > 0));
  await openMenu();
  await clickMenuRow('Look'); await wait(400);
  check('Look popup offers self-examine', await D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].some(r => r.textContent.includes('yourself'))));
  await D(() => $('#rpg-action-popup').remove());

  // ── Party rows: find somebody, join / disband silently ──
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

  let before = await chatLen();
  await openMenu();
  check('Party row shown with joinable NPC present', await clickMenuRow('Party')); await wait(400);
  check(`popup offers "${npc} joins the party"`, await clickPopupRow('joins the party')); await wait(1200);
  check('joined the party', await D((n) => window.rpgCustodianDebug.state().party.includes(n), npc));
  let narr = await narrationSince(before);
  check('join produced no narration', narr.length === 0, narr.join(' | '));
  await openMenu();
  check('menu row shows party count', (await menuRows()).some(r => r.includes('Party (1)')));

  // Disband, she stays here
  before = await chatLen();
  check('popup offers "she stays here"', (await clickMenuRow('Party'), await wait(400), await clickPopupRow('she stays here'))); await wait(1500);
  check('left the party', await D((n) => !window.rpgCustodianDebug.state().party.includes(n), npc));
  check('lingering pin set here', await D((n, l) => window.rpgCustodianDebug.rel(n).partedAt === l, npc, found.loc));
  check('still present here', (await D(() => window.rpgCustodianDebug.presence())).includes(npc));
  narr = await narrationSince(before);
  check('quiet disband produced no narration/farewell', narr.length === 0, narr.join(' | '));

  // Disband back to her routine, from a spot that is not her scheduled one
  await D((n) => window.rpgCustodianDebug.addParty(n), npc); await wait(800);
  const away = await D((n) => {
    const dbg = window.rpgCustodianDebug;
    for (const loc of Object.keys(dbg.state().worldData.locations)) if (loc !== dbg.slot(n).loc) return loc;
    return null;
  }, npc);
  await D((l) => window.rpgCustodianDebug.teleport(l), away); await wait(800);
  check('party member travelled with player', (await D(() => window.rpgCustodianDebug.presence())).includes(npc));
  before = await chatLen();
  await openMenu();
  check('popup offers "back to her routine"', (await clickMenuRow('Party'), await wait(400), await clickPopupRow('back to her routine'))); await wait(1500);
  check('left the party', await D((n) => !window.rpgCustodianDebug.state().party.includes(n), npc));
  check('no lingering pin', await D((n) => !window.rpgCustodianDebug.rel(n).partedAt, npc));
  check('gone from here', !(await D(() => window.rpgCustodianDebug.presence())).includes(npc));
  const schedLoc = await D((n) => window.rpgCustodianDebug.slot(n).loc, npc);
  check('present at her scheduled spot', (await D((l) => window.rpgCustodianDebug.presence(l), schedLoc)).includes(npc), `${schedLoc}`);
  narr = await narrationSince(before);
  check('routine disband produced no narration/farewell', narr.length === 0, narr.join(' | '));

  // ── Items & Statuses popup ──
  await D(() => window.rpgCustodianDebug.buff('player', 'charm', 1, 'Test Elixir'));
  await D(() => window.rpgCustodianDebug.addObjective({ name: 'Find the lost cat', end_condition: 'the cat is returned to Marta', reward: { gold: 5 } }));
  await openMenu();
  check('menu row renamed to Items & Statuses', (await menuRows()).some(r => r.includes('Items & Statuses')));
  check('menu row counts the quest', (await menuRows()).some(r => r.includes('1 quest')));
  await clickMenuRow('Items & Statuses'); await wait(400);
  check('popup titled Items & Statuses', (await D(() => document.querySelector('#rpg-action-popup .rpg-popup-title')?.textContent || '')).includes('Items & Statuses'));
  check('Quests & objectives heading shown', await D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-item-head')].some(h => h.textContent.includes('Quests & objectives'))));
  check('quest row shows condition and reward', await D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].some(r => r.textContent.includes('Find the lost cat') && r.textContent.includes('returned to Marta') && r.textContent.includes('5 gold'))));
  check('quests come before statuses', await D(() => { const heads = [...document.querySelectorAll('#rpg-action-popup .rpg-item-head')].map(h => h.textContent); return heads.indexOf('Quests & objectives') < heads.indexOf('Active statuses'); }));
  check('Active statuses heading shown', await D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-item-head')].some(h => h.textContent.includes('Active statuses'))));
  check('status row shows the buff with its mods', await D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].some(r => r.textContent.includes('Test Elixir') && r.textContent.includes('+1 charm'))));
  check('quest row precedes the status row', await D(() => { const rows = [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].map(r => r.textContent); return rows.findIndex(t => t.includes('lost cat')) < rows.findIndex(t => t.includes('Test Elixir')); }));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Test Elixir'));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Find the lost cat'));
  await openMenu();
  await clickMenuRow('Items & Statuses'); await wait(400);
  check('unafflicted placeholder when no statuses', await D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].some(r => r.textContent.includes('unafflicted'))));
  await D(() => $('#rpg-action-popup').remove());

  // ── Mobile pass on a fresh page: everything by tap, on-screen ──
  const mob = await browser.newPage();
  const M = (fn, ...a) => mob.evaluate(fn, ...a);
  try {
    await useMobileViewport(mob);
    await login(mob);
    await mob.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await M((w) => window.rpgCustodianDebug.continueGame(w), 'prototype-town'); await wait(15000);
    await M((n) => window.rpgCustodianDebug.teleport(window.rpgCustodianDebug.slot(n).loc), npc); await wait(800);
    const tapEl = async (sel, text) => {
      const p = await M((sel, t) => {
        const el = [...document.querySelectorAll(sel)].find(e => !t || e.textContent.includes(t));
        if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, sel, text);
      if (!p) return false; await mob.touchscreen.tap(p.x, p.y); return true;
    };
    check('mobile: RPG button tappable', await tapEl('#rpg-menu-button')); await wait(400);
    const mrect = await M(() => { const el = document.getElementById('rpg-menu-popup'); if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: window.innerWidth, h: window.innerHeight }; });
    check('mobile: menu opens on tap', !!mrect);
    if (mrect) check('mobile: menu fully on-screen', mrect.l >= 0 && mrect.t >= 0 && mrect.r <= mrect.w && mrect.b <= mrect.h, JSON.stringify(mrect));
    check('mobile: Party row present', await tapEl('#rpg-menu-popup .rpg-menu-item', 'Party')); await wait(400);
    const prect = await M(() => { const el = document.getElementById('rpg-action-popup'); if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: window.innerWidth, h: window.innerHeight }; });
    check('mobile: party popup opens on tap', !!prect);
    if (prect) check('mobile: party popup fully on-screen', prect.l >= 0 && prect.t >= 0 && prect.r <= prect.w && prect.b <= prect.h, JSON.stringify(prect));
    if (await tapEl('#rpg-action-popup .rpg-menu-item', 'joins the party')) {
      await wait(1200);
      check('mobile: tap joins the party', await M((n) => window.rpgCustodianDebug.state().party.includes(n), npc));
      await M((n) => window.rpgCustodianDebug.removeParty(n, { quiet: true, resumeSchedule: true }), npc); await wait(800);
    } else check('mobile: join row offered', false);
  } finally { await mob.close(); }

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
