// World Manager (world-management phase 2):
//  - Worlds popup lists shipped + authored worlds
//  - Create wizard (minimal): name/description/first location, conflict-safe
//  - authored worlds are playable end-to-end (New Game, empty cast, no bg)
//  - Delete removes an authored world
//  - mobile pass: popup lands on-screen at 390x844
import { connect, collectLogs, login, useMobileViewport } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
let dialogQueue = [];
page.on('dialog', async d => await d.accept(dialogQueue.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const openMenuItem = async (label) => {
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(l => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes(l))?.click(), label);
    await wait(600);
};
const popupItems = () => page.evaluate(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].map(e => e.textContent.trim()));
const clickPopupItem = async (label) => {
    await page.evaluate(l => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(e => e.textContent.includes(l))?.click(), label);
    await wait(600);
};

try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    // Clean any leftover authored world from a previous run
    await page.evaluate(() => { const s = SillyTavern.getContext().extensionSettings['rpg-custodian']; if (s?.authoredWorlds) { delete s.authoredWorlds['testrealm-alpha']; } });
    dialogQueue = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
    await openMenuItem('Create Character'); await wait(5000);

    // ---- Worlds popup lists shipped world ----
    await openMenuItem('Worlds (create');
    let items = await popupItems();
    console.log('worlds popup:', JSON.stringify(items).slice(0, 220));
    check('Worlds popup opens with Create + shipped world', items.some(i => /Create a new world/.test(i)) && items.some(i => /shipped/.test(i)));

    // ---- Create (minimal wizard) ----
    dialogQueue = ['Testrealm Alpha', 'A wind-swept test realm.', 'Windmill Hill'];
    await clickPopupItem('Create a new world'); await wait(1000);
    let worlds = await page.evaluate(() => Object.keys(SillyTavern.getContext().extensionSettings['rpg-custodian']?.authoredWorlds || {}));
    check('authored world created in settings', worlds.includes('testrealm-alpha'), worlds.join(','));

    // ---- Conflict: same name again exits without creating a duplicate ----
    await openMenuItem('Worlds (create');
    dialogQueue = ['Testrealm Alpha'];   // conflict → re-prompt gets '' → abort
    await clickPopupItem('Create a new world'); await wait(800);
    worlds = await page.evaluate(() => Object.keys(SillyTavern.getContext().extensionSettings['rpg-custodian']?.authoredWorlds || {}));
    check('name conflict does not create a duplicate', worlds.filter(w => w.startsWith('testrealm')).length === 1);

    // ---- Authored world in the manager list + playable ----
    await openMenuItem('Worlds (create');
    items = await popupItems();
    check('authored world listed', items.some(i => /Testrealm Alpha/.test(i) && /authored/.test(i)));
    await page.keyboard.press('Escape'); await page.evaluate(() => document.getElementById('rpg-action-popup')?.remove());
    await openMenuItem('New Game: Testrealm Alpha'); await wait(15000);
    const state = await page.evaluate(() => { const s = window.rpgCustodianDebug.state(); return { active: s.isActive, loc: s.currentLocation, world: s.worldData?.name }; });
    check('authored world playable (New Game)', state.active && state.loc === 'windmill-hill' && state.world === 'Testrealm Alpha', JSON.stringify(state));
    const intro = await page.evaluate(() => [...SillyTavern.getContext().chat].reverse().find(m => (m.mes || '').includes('New Game Started'))?.mes || '');
    check('intro message in fresh chat', /Testrealm Alpha/.test(intro));

    // ---- Delete authored world ----
    await openMenuItem('Worlds (create');
    await clickPopupItem('Testrealm Alpha');
    dialogQueue = ['confirm'];
    await clickPopupItem('Delete world'); await wait(800);
    worlds = await page.evaluate(() => Object.keys(SillyTavern.getContext().extensionSettings['rpg-custodian']?.authoredWorlds || {}));
    check('delete removes the authored world', !worlds.includes('testrealm-alpha'));

    // ---- Mobile pass ----
    const page2 = await browser.newPage();
    page2.on('dialog', async d => await d.accept(''));
    await useMobileViewport(page2);
    await login(page2);
    await page2.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await wait(2000);
    await page2.tap('#rpg-menu-button'); await wait(500);
    await page2.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Worlds (create'))?.click());
    await wait(700);
    const rect = await page2.evaluate(() => { const p = document.getElementById('rpg-action-popup'); if (!p) return null; const r = p.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: window.innerWidth, vh: window.innerHeight }; });
    console.log('mobile popup rect:', JSON.stringify(rect));
    check('mobile: Worlds popup fully on-screen', !!rect && rect.l >= 0 && rect.t >= 0 && rect.r <= rect.vw && rect.b <= rect.vh);
    await page2.close();

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
