// Travel popup: bigger destination rows, and after picking one it reopens at
// the NEW location (chained moves). Area notes: public notes append to the
// description surfaces; secret notes stay out of the shared block and chat,
// reach only the privy (per-NPC injection substrate + GM prompt line), the
// Custodian always sees everything, and the whole thing survives the save.
import { connect, login, useMobileViewport } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A bold adventurer.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };

const openMenu = async () => { await D(() => { $('#rpg-menu-popup').remove(); $('#rpg-action-popup').remove(); $('#rpg-areanote-form').remove(); }); await page.click('#rpg-menu-button'); await wait(300); };
const clickMenuRow = (text) => D((t) => { const r = [...document.querySelectorAll('#rpg-menu-popup .rpg-menu-item')].find(r => r.textContent.includes(t)); if (!r) return false; r.click(); return true; }, text);
const popupRows = () => D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].map(r => ({ text: r.textContent.trim(), big: r.classList.contains('rpg-item-big') })));
const popupTitle = () => D(() => document.querySelector('#rpg-action-popup .rpg-popup-title')?.textContent || '');

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

  // ── Travel popup: big rows + chained reopen ──
  const startLoc = await D(() => window.rpgCustodianDebug.state().currentLocation);
  await openMenu();
  await clickMenuRow('Move'); await wait(400);
  let rows = await popupRows();
  check('travel rows are big', rows.length > 0 && rows.every(r => r.big), JSON.stringify(rows.map(r => r.text)));
  check('travel title names where you stand', (await popupTitle()).includes('from'));
  const destText = rows[0].text;
  await D((t) => { [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(r => r.textContent.trim() === t)?.click(); }, destText);
  await wait(2500);
  const newLoc = await D(() => window.rpgCustodianDebug.state().currentLocation);
  check('the move happened', newLoc !== startLoc, `${startLoc} → ${newLoc}`);
  check('travel popup REOPENED at the new location', await D(() => !!document.getElementById('rpg-action-popup')));
  check('reopened title names the new location', (await popupTitle()).includes(await D((l) => window.rpgCustodianDebug.state().worldData.locations[l].name, newLoc)));
  // Chain a second hop from the reopened popup, then dismiss by tapping away.
  rows = await popupRows();
  await D((t) => { [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(r => r.textContent.trim() === t)?.click(); }, rows[0].text);
  await wait(2500);
  check('second hop chained without reopening the menu', await D(() => !!document.getElementById('rpg-action-popup')));
  await page.mouse.click(20, 200); await wait(300);
  check('tapping away dismisses it', await D(() => !document.getElementById('rpg-action-popup')));

  // ── Area notes: engine surfaces ──
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);
  await D(() => window.rpgCustodianDebug.areaNoteClear());
  await D(() => window.rpgCustodianDebug.areaNoteAdd({ text: 'The old bridge outside has collapsed into the river.' }));
  await D(() => window.rpgCustodianDebug.areaNoteAdd({ text: 'A hidden stash of soul crystals sits behind the bar.', secret: true, privy: ['Marta', 'Game Master'] }));

  const statusText = await D(() => window.rpgCustodianDebug.statusText());
  check('public note rides the shared scene line', statusText.includes('bridge outside has collapsed'));
  check('secret note stays OUT of the shared block', !statusText.includes('hidden stash'));
  check('privy NPC gets the secret', (await D(() => window.rpgCustodianDebug.areaSecretsFor('Marta'))).length === 1);
  check('non-privy NPC gets nothing', (await D(() => window.rpgCustodianDebug.areaSecretsFor('Fern'))).length === 0);
  const gmLine = await D(() => window.rpgCustodianDebug.gmAreaLine());
  check('GM narration line carries both', gmLine.includes('bridge') && gmLine.includes('hidden stash'));
  const anLine = await D(() => window.rpgCustodianDebug.analyzerAreaNotes());
  check('Custodian sees everything, secrecy-tagged', anLine.includes('bridge') && anLine.includes('[SECRET — known only to: Marta, Game Master]'));

  const before = await D(() => SillyTavern.getContext().chat.length);
  await D(() => window.rpgCustodianDebug.look()); await wait(400);
  const lookMes = await D((n) => SillyTavern.getContext().chat.slice(n).map(m => m.mes).join('\n'), before);
  check('look shows the public note', lookMes.includes('bridge outside has collapsed'));
  check('look never prints the secret into chat', !lookMes.includes('hidden stash'));

  check('notes persist into the save', await D(() => {
    const s = SillyTavern.getContext().extensionSettings['rpg-custodian'].currentSave;
    return (s.areaNotes?.inn || []).length === 2;
  }));

  // GM not privy → his line hides the secret
  await D(() => window.rpgCustodianDebug.areaNoteClear());
  await D(() => window.rpgCustodianDebug.areaNoteAdd({ text: 'A trapdoor under the rug.', secret: true, privy: ['Marta'] }));
  check('GM excluded when not on the privy list', !(await D(() => window.rpgCustodianDebug.gmAreaLine())).includes('trapdoor'));
  await D(() => window.rpgCustodianDebug.areaNoteClear());

  // ── Area notes: UI flow ──
  await openMenu();
  check('menu has an Area Notes row', await clickMenuRow('Area Notes')); await wait(400);
  check('manager offers Add a note', await D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].some(r => r.textContent.includes('Add a note'))));
  await D(() => { [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(r => r.textContent.includes('Add a note'))?.click(); }); await wait(400);
  check('note form opens', await D(() => !!document.getElementById('rpg-areanote-form')));
  check('privy list hidden while public', await D(() => $('#an-privy').is(':hidden')));
  await D(() => { $('#an-text').val('The hearth fire has gone out.'); });
  await D(() => { document.getElementById('an-secret').click(); }); await wait(200);
  check('secret toggle reveals the privy list', await D(() => $('#an-privy').is(':visible')));
  const frect = await D(() => { const r = document.getElementById('rpg-areanote-form').getBoundingClientRect(); return { t: r.top, b: r.bottom, h: window.innerHeight }; });
  check('grown form stays fully on-screen', frect.t >= 0 && frect.b <= frect.h, JSON.stringify(frect));
  const privy = await D(() => [...document.querySelectorAll('#an-privy-list input')].map(cb => ({ name: cb.getAttribute('data-name'), on: cb.checked })));
  check('GM is on the selector list', privy.some(p => p.name === 'Game Master'), JSON.stringify(privy.map(p => p.name)));
  check('EVERYONE defaults off on a new secret', privy.every(p => !p.on));
  await D(() => { const cb = [...document.querySelectorAll('#an-privy-list input')].find(c => c.getAttribute('data-name') === 'Marta'); if (cb) cb.checked = true; });
  await D(() => { document.getElementById('an-save').click(); }); await wait(400);
  const saved = await D(() => window.rpgCustodianDebug.areaNotes());
  check('form saved a secret note privy to Marta only', saved.length === 1 && saved[0].secret && saved[0].privy.length === 1 && saved[0].privy[0] === 'Marta', JSON.stringify(saved));
  check('manager reopened after save', await D(() => !!document.getElementById('rpg-action-popup')));
  // Edit it: tap the row, delete it.
  await D(() => { [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(r => r.textContent.includes('hearth fire'))?.click(); }); await wait(400);
  check('tapping a note opens it for editing', await D(() => !!document.getElementById('rpg-areanote-form') && $('#an-text').val().includes('hearth fire')));
  await D(() => { document.getElementById('an-delete').click(); }); await wait(400);
  check('delete removes the note', (await D(() => window.rpgCustodianDebug.areaNotes())).length === 0);

  // ── Mobile: form on-screen and tappable ──
  const mob = await browser.newPage();
  const M = (fn, ...a) => mob.evaluate(fn, ...a);
  try {
    await useMobileViewport(mob);
    await login(mob);
    await mob.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await M((w) => window.rpgCustodianDebug.continueGame(w), 'prototype-town'); await wait(15000);
    const tapEl = async (sel, text) => {
      const p = await M((sel, t) => {
        const el = [...document.querySelectorAll(sel)].find(e => !t || e.textContent.includes(t));
        if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, sel, text);
      if (!p) return false; await mob.touchscreen.tap(p.x, p.y); return true;
    };
    await tapEl('#rpg-menu-button'); await wait(400);
    check('mobile: Area Notes row present', await tapEl('#rpg-menu-popup .rpg-menu-item', 'Area Notes')); await wait(400);
    check('mobile: manager opens', await tapEl('#rpg-action-popup .rpg-menu-item', 'Add a note')); await wait(400);
    const rect = await M(() => { const el = document.getElementById('rpg-areanote-form'); if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: window.innerWidth, h: window.innerHeight }; });
    check('mobile: note form opens on tap', !!rect);
    if (rect) check('mobile: note form fully on-screen', rect.l >= 0 && rect.t >= 0 && rect.r <= rect.w && rect.b <= rect.h, JSON.stringify(rect));
    await tapEl('#an-secret'); await wait(300);
    const rect2 = await M(() => { const el = document.getElementById('rpg-areanote-form'); if (!el) return null; const r = el.getBoundingClientRect(); return { t: r.top, b: r.bottom, h: window.innerHeight }; });
    check('mobile: grown form stays on-screen after secret toggle', rect2 && rect2.t >= 0 && rect2.b <= rect2.h, JSON.stringify(rect2));
    await tapEl('#an-cancel'); await wait(300);
    // Travel rows big enough to tap comfortably (≥40px tall)
    await M(() => $('#rpg-action-popup').remove());
    await tapEl('#rpg-menu-button'); await wait(400);
    await tapEl('#rpg-menu-popup .rpg-menu-item', 'Move'); await wait(400);
    const h = await M(() => { const r = document.querySelector('#rpg-action-popup .rpg-item-big'); return r ? r.getBoundingClientRect().height : 0; });
    check('mobile: travel rows are comfortably tall', h >= 40, `${h}px`);
  } finally { await mob.close(); }

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
