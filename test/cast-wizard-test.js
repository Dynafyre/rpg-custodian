// Cast onboarding wizard (world-management phase 4):
//  - import a real V2 card file (Trizel.png) through the wizard
//  - RPG-ify form writes the rpg_custodian block into world.castData
//  - the world plays with her: roster, presence at home, common knowledge
//  - edit + remove flows; mobile form on-screen
import { connect, collectLogs, login, useMobileViewport } from './harness.js';
import { copyFileSync } from 'node:fs';
// The flatpak'd test Chromium can only read its own app dir — stage the card
// there so the file chooser can actually open it (host paths → NotFoundError).
const TRIZEL_SRC = '/var/home/Erik/Silly-Tavern/SillyTavern-Launcher/SillyTavern/data/default-user/characters/Trizel.png';
const TRIZEL = '/home/Erik/.var/app/io.github.ungoogled_software.ungoogled_chromium/data/Trizel.png';
copyFileSync(TRIZEL_SRC, TRIZEL);
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
let dialogQueue = [];
page.on('dialog', async d => await d.accept(dialogQueue.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const world = () => page.evaluate(() => structuredClone(SillyTavern.getContext().extensionSettings['rpg-custodian']?.authoredWorlds?.['castlandia'] || null));
const openMenuItem = async (label) => {
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(l => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes(l))?.click(), label);
    await wait(600);
};
const clickPopupItem = async (label) => {
    await page.evaluate(l => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(e => e.textContent.includes(l))?.click(), label);
    await wait(600);
};

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.evaluate(async () => {
        const s = SillyTavern.getContext().extensionSettings['rpg-custodian'];
        if (s?.authoredWorlds) delete s.authoredWorlds['castlandia'];
        await window.rpgCustodianDebug.refreshWorlds();
    });
    dialogQueue = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
    await openMenuItem('Create Character'); await wait(5000);

    // ---- world to cast into ----
    await openMenuItem('Worlds (play');
    dialogQueue = ['Castlandia', 'A casting-couch of a realm.', 'Green Village'];
    await clickPopupItem('Create a new world'); await wait(800);

    // ---- import Trizel's card file through the wizard ----
    await openMenuItem('Worlds (play');
    await clickPopupItem('Castlandia');
    await clickPopupItem('👥 Cast'); await wait(500);
    const [chooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }),
        clickPopupItem('Import a card file'),
    ]);
    await chooser.accept([TRIZEL]);
    await wait(6000);   // import + getCharacters + form open
    const formOpen = await page.evaluate(() => !!document.getElementById('rpg-cast-overlay'));
    check('import opens the RPG-ify form', formOpen);
    const charName = await page.evaluate(() => document.querySelector('#rpg-cast-overlay .rpg-popup-title')?.textContent || '');
    console.log('form title:', charName);

    // ---- fill and save ----
    await page.type('#cf-role', 'wandering alchemist');
    await page.type('#cf-race', 'tiefling');
    await page.type('#cf-age', 'mid 20s');
    await page.evaluate(() => { document.getElementById('cf-fert').value = '40'; document.getElementById('cf-rug').value = '3'; });
    await page.click('#cf-secret'); await wait(200);   // toggle secret ON (button, not checkbox)
    check('secret toggle flips on click', await page.evaluate(() => document.getElementById('cf-secret').getAttribute('data-on')) === '1');
    await page.click('#cf-secret'); await wait(200);   // and back off
    await page.click('#cf-save'); await wait(800);
    let w = await world();
    const castName = (w.cast || [])[0];
    console.log('cast:', JSON.stringify(w.cast));
    check('cast member saved', !!castName && /trizel/i.test(castName));
    const rc = (w.castData?.[castName]?.data || w.castData?.[castName])?.extensions?.rpg_custodian || {};
    console.log('rpg block:', JSON.stringify(rc).slice(0, 300));
    check('rpg_custodian block written', rc.role === 'wandering alchemist' && rc.fertility === 40 && rc.home_location === 'green-village' && rc.schedule?.Morning === 'green-village');

    // ---- the world plays with her ----
    await page.evaluate(() => window.rpgCustodianDebug.newGame('castlandia')); await wait(25000);
    const roster = await page.evaluate(() => (window.rpgCustodianDebug.state().npcRoster || []).map(n => `${n.name}:${n.role}`));
    console.log('roster:', JSON.stringify(roster));
    check('she is on the roster with her role', roster.some(r => /trizel/i.test(r) && /alchemist/.test(r)));
    const present = await page.evaluate(() => window.rpgCustodianDebug.state().party !== undefined && (SillyTavern.getContext().extensionPrompts?.['RPG_CUSTODIAN_STATUS']?.value || ''));
    check('she is projected to the scene (status block)', /trizel/i.test(present) && /alchemist/.test(present));

    // ---- edit flow ----
    await openMenuItem('Worlds (play');
    await clickPopupItem('Castlandia');
    await clickPopupItem('👥 Cast'); await wait(400);
    await clickPopupItem(castName); await wait(400);
    await clickPopupItem('Edit RPG details'); await wait(500);
    check('edit reopens form with saved values', await page.evaluate(() => document.getElementById('cf-role')?.value) === 'wandering alchemist');
    await page.evaluate(() => { document.getElementById('cf-role').value = 'master alchemist'; });
    await page.click('#cf-save'); await wait(600);
    w = await world();
    const rc2 = (w.castData?.[castName]?.data || w.castData?.[castName])?.extensions?.rpg_custodian || {};
    check('edit saves + bumps card_version', rc2.role === 'master alchemist' && parseFloat(rc2.card_version) > parseFloat(rc.card_version), `${rc.card_version} → ${rc2.card_version}`);

    // ---- remove flow ----
    await openMenuItem('Worlds (play');
    await clickPopupItem('Castlandia');
    await clickPopupItem('👥 Cast'); await wait(400);
    await clickPopupItem(castName); await wait(400);
    dialogQueue = ['ok'];
    await clickPopupItem('Remove from cast'); await wait(600);
    w = await world();
    check('remove empties the cast (character stays installed)', (w.cast || []).length === 0 && !w.castData?.[castName]);

    // ---- mobile: picker + form on-screen ----
    const page2 = await browser.newPage();
    page2.on('dialog', async d => await d.accept(''));
    await page2.setCacheEnabled(false);
    await useMobileViewport(page2);
    await login(page2);
    await page2.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await wait(2000);
    await page2.tap('#rpg-menu-button'); await wait(500);
    await page2.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Worlds (play'))?.click()); await wait(500);
    await page2.evaluate(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(e => e.textContent.includes('Castlandia'))?.click()); await wait(500);
    await page2.evaluate(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(e => e.textContent.includes('👥 Cast'))?.click()); await wait(500);
    await page2.evaluate(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(e => e.textContent.includes('Add from installed'))?.click()); await wait(700);
    const rect = await page2.evaluate(() => { const p = document.querySelector('#rpg-cast-overlay .rpg-form-panel'); if (!p) return null; const r = p.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
    console.log('mobile picker rect:', JSON.stringify(rect));
    check('mobile: picker panel fully on-screen', !!rect && rect.l >= 0 && rect.t >= 0 && rect.r <= rect.vw && rect.b <= rect.vh);
    // TOUCH-tap a character → form → touch-tap the secret toggle (the reported bug)
    const rowRect = await page2.evaluate(() => { const el = document.querySelector('#cast-list .rpg-menu-item'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (rowRect) {
        await page2.touchscreen.tap(rowRect.x, rowRect.y); await wait(700);
        const tgl = await page2.evaluate(() => { const b = document.getElementById('cf-secret'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        if (tgl) {
            await page2.touchscreen.tap(tgl.x, tgl.y); await wait(300);
            check('mobile: secret toggle responds to TOUCH', await page2.evaluate(() => document.getElementById('cf-secret').getAttribute('data-on')) === '1');
            await page2.evaluate(() => document.getElementById('cf-cancel')?.click());
        } else check('mobile: secret toggle responds to TOUCH', false, 'form did not open');
    } else check('mobile: secret toggle responds to TOUCH', false, 'no characters in picker');
    await page2.screenshot({ path: 'screenshots/cast-wizard-mobile.png' });
    await page2.close();

    // cleanup
    await page.evaluate(async () => {
        const s = SillyTavern.getContext().extensionSettings['rpg-custodian'];
        if (s?.authoredWorlds) delete s.authoredWorlds['castlandia'];
        await window.rpgCustodianDebug.refreshWorlds();
        SillyTavern.getContext().saveSettingsDebounced();
    });

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
