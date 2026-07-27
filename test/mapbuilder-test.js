// Graphical map builder (world-management phase 3):
//  desktop: create world → open editor → add nodes → edit panel (name/secret/
//  star) → join → drag → line delete → zoom → close → playable
//  mobile 390x844: editor opens, add via tap, panel on-screen
import { connect, collectLogs, login, useMobileViewport } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
let dialogQueue = [];
page.on('dialog', async d => await d.accept(dialogQueue.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const world = () => page.evaluate(() => structuredClone(SillyTavern.getContext().extensionSettings['rpg-custodian']?.authoredWorlds?.['cartographia'] || null));
const openMenuItem = async (label) => {
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(l => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes(l))?.click(), label);
    await wait(600);
};
const clickPopupItem = async (label) => {
    await page.evaluate(l => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(e => e.textContent.includes(l))?.click(), label);
    await wait(600);
};
const mapBtn = async (act) => { await page.evaluate(a => document.querySelector(`.rpg-map-btn[data-act="${a}"]`)?.click(), act); await wait(400); };
const nodeCenter = (id) => page.evaluate(x => { const el = document.querySelector(`.rpg-map-node[data-id="${x}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
const clickNode = async (id) => { const c = await nodeCenter(id); await page.mouse.click(c.x, c.y); await wait(300); };

try {
    await page.setCacheEnabled(false);   // style.css has no cache-buster; stale CSS poisoned a prior mobile run
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.evaluate(async () => {
        const s = SillyTavern.getContext().extensionSettings['rpg-custodian'];
        if (s?.authoredWorlds) for (const k of Object.keys(s.authoredWorlds)) if (/cartographia|map-testing/.test(k)) delete s.authoredWorlds[k];
        await window.rpgCustodianDebug.refreshWorlds();
    });
    dialogQueue = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
    await openMenuItem('Create Character'); await wait(5000);

    // ---- create world + open the editor ----
    await openMenuItem('Worlds (play');
    dialogQueue = ['Cartographia', 'A map-testing realm.', 'Harbor'];
    await clickPopupItem('Create a new world'); await wait(800);
    await openMenuItem('Worlds (play');
    await clickPopupItem('Cartographia');
    await clickPopupItem('Edit world'); await wait(800);
    check('editor opens', await page.evaluate(() => !!document.getElementById('rpg-map-editor')));

    // ---- add two nodes, name them via the panel ----
    await mapBtn('add');   // node auto-selected, panel opens
    await page.evaluate(() => { document.getElementById('mp-name').value = ''; });
    await page.type('#mp-name', 'Old Lighthouse');
    await page.evaluate(() => document.getElementById('mp-secret').value = '2');
    await page.click('#mp-save'); await wait(400);
    await page.evaluate(() => { const m = window; }); // noop spacing
    await mapBtn('add');
    await page.evaluate(() => { document.getElementById('mp-name').value = ''; });
    await page.type('#mp-name', 'Fish Market');
    await page.click('#mp-save'); await wait(400);
    let w = await world();
    const ids = Object.keys(w.locations);
    console.log('locations:', JSON.stringify(ids), '| names:', Object.values(w.locations).map(l => `${l.name}(s${l.secret || 0})`).join(', '));
    check('three locations exist', ids.length === 3);
    check('names + secrecy saved from panel', Object.values(w.locations).some(l => l.name === 'Old Lighthouse' && l.secret === 2) && Object.values(w.locations).some(l => l.name === 'Fish Market'));

    // ---- select all three, Join, verify pairwise connections ----
    const vpRect = await page.evaluate(() => { const r = document.getElementById('rpg-map-viewport').getBoundingClientRect(); return { x: r.left, y: r.top }; });
    await page.mouse.click(vpRect.x + 15, vpRect.y + 15); await wait(300);   // empty tap clears selection
    for (const id of ids) await clickNode(id);
    await mapBtn('join');
    w = await world();
    const degree = Object.values(w.locations).map(l => (l.connections || []).length);
    check('join created pairwise connections', degree.every(d => d === 2), degree.join(','));

    // ---- drag a node, coords persist ----
    const dragId = ids[1];
    const before = (await world()).locations[dragId];
    const c = await nodeCenter(dragId);
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 90, c.y + 60, { steps: 8 }); await page.mouse.up(); await wait(400);
    const after = (await world()).locations[dragId];
    check('drag moves the node (relative coords change)', Math.abs(after.x - before.x) > 0.01 || Math.abs(after.y - before.y) > 0.01, `${before.x.toFixed(3)},${before.y.toFixed(3)} → ${after.x.toFixed(3)},${after.y.toFixed(3)}`);

    // ---- tap a connection line → confirm removes it ----
    dialogQueue = ['ok'];
    const lineHit = await page.evaluate(() => { const l = document.querySelector('.rpg-map-linehit'); if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, a: l.dataset.a, b: l.dataset.b }; });
    await page.mouse.click(lineHit.x, lineHit.y); await wait(400);
    w = await world();
    check('tapping a path removes it after confirm', !(w.locations[lineHit.a].connections || []).includes(lineHit.b));

    // ---- zoom buttons change the view ----
    const scale0 = await page.evaluate(() => document.getElementById('rpg-map-stage').style.transform);
    await mapBtn('zoomin'); await mapBtn('zoomin');
    const scale1 = await page.evaluate(() => document.getElementById('rpg-map-stage').style.transform);
    check('zoom buttons rescale the stage', scale0 !== scale1);

    // ---- close saves; world is playable with edits ----
    await mapBtn('close'); await wait(600);
    check('editor closed', await page.evaluate(() => !document.getElementById('rpg-map-editor')));
    await page.evaluate(() => window.rpgCustodianDebug.newGame('cartographia')); await wait(15000);
    const state = await page.evaluate(() => { const s = window.rpgCustodianDebug.state(); return { active: s.isActive, loc: s.currentLocation, secretKnown: !!s.worldData.locations && Object.values(s.worldData.locations).some(l => l.secret === 2) }; });
    check('edited world playable, secret node intact', state.active && state.secretKnown, JSON.stringify(state));

    // ---- mobile pass ----
    const page2 = await browser.newPage();
    page2.on('dialog', async d => await d.accept(''));
    await page2.setCacheEnabled(false);
    await useMobileViewport(page2);
    await login(page2);
    await page2.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await wait(2000);
    await page2.tap('#rpg-menu-button'); await wait(500);
    await page2.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Worlds (play'))?.click()); await wait(600);
    await page2.evaluate(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(e => e.textContent.includes('Cartographia'))?.click()); await wait(600);
    await page2.evaluate(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(e => e.textContent.includes('Edit world'))?.click()); await wait(900);
    check('mobile: editor opens', await page2.evaluate(() => !!document.getElementById('rpg-map-editor')));
    const addBtn = await page2.evaluate(() => { const b = document.querySelector('.rpg-map-btn[data-act="add"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page2.touchscreen.tap(addBtn.x, addBtn.y); await wait(700);
    const panelRect = await page2.evaluate(() => { const p = document.getElementById('rpg-map-panel'); if (!p) return null; const r = p.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
    console.log('mobile panel rect:', JSON.stringify(panelRect));
    check('mobile: tap ➕ opens panel fully on-screen', !!panelRect && panelRect.l >= 0 && panelRect.t >= 0 && panelRect.r <= panelRect.vw && panelRect.b <= panelRect.vh);
    await page2.screenshot({ path: 'screenshots/mapbuilder-mobile.png' });
    // cleanup: cancel panel, close editor, remove test world
    await page2.evaluate(() => document.getElementById('mp-cancel')?.click());
    await page2.evaluate(() => document.querySelector('.rpg-map-btn[data-act="close"]')?.click()); await wait(500);
    await page2.close();
    await page.evaluate(async () => {
        const s = SillyTavern.getContext().extensionSettings['rpg-custodian'];
        if (s?.authoredWorlds) for (const k of Object.keys(s.authoredWorlds)) if (/cartographia|map-testing/.test(k)) delete s.authoredWorlds[k];
        await window.rpgCustodianDebug.refreshWorlds();
        SillyTavern.getContext().saveSettingsDebounced();
    });

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
