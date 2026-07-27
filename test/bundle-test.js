// World bundles (world-management phase 6): export prototype-town as a
// .rpgworld zip, then import it back — world-name conflict forces a rename
// prompt — and play the imported copy.
import { connect, collectLogs, login } from './harness.js';
import { existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
const DL = '/home/Erik/.var/app/io.github.ungoogled_software.ungoogled_chromium/data/rpgc-dl';
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
const clickPopupItem = async (label) => {
    await page.evaluate(l => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(e => e.textContent.includes(l))?.click(), label);
    await wait(600);
};

try {
    rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.evaluate(async () => {
        const s = SillyTavern.getContext().extensionSettings['rpg-custodian'];
        if (s?.authoredWorlds) for (const k of Object.keys(s.authoredWorlds)) if (/prototype-reborn/.test(k)) delete s.authoredWorlds[k];
        await window.rpgCustodianDebug.refreshWorlds();
    });
    dialogQueue = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
    await openMenuItem('Create Character'); await wait(5000);

    // downloads land in the flatpak-visible dir
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

    // ---- export prototype-town ----
    await openMenuItem('Worlds (play');
    await clickPopupItem('Mountain');
    await clickPopupItem('Export bundle');
    let bundle = null;
    for (let i = 0; i < 30; i++) { await wait(1000); const fs2 = readdirSync(DL).filter(f => f.endsWith('.rpgworld')); if (fs2.length) { bundle = `${DL}/${fs2[0]}`; break; } }
    check('bundle downloaded', !!bundle, bundle || 'timeout');

    // ---- import it back: name conflict → rename to Prototype Reborn ----
    await openMenuItem('Worlds (play');
    dialogQueue = ['Prototype Reborn'];
    const [chooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }),
        clickPopupItem('Import world bundle'),
    ]);
    await chooser.accept([bundle]);
    await wait(8000);
    const imported = await page.evaluate(() => structuredClone(SillyTavern.getContext().extensionSettings['rpg-custodian']?.authoredWorlds?.['prototype-reborn'] || null));
    check('imported under the renamed id', !!imported, Object.keys(imported || {}).join(','));
    check('locations survived the round trip', imported && Object.keys(imported.locations).length >= 8, `${imported ? Object.keys(imported.locations).length : 0} locations`);
    check('castData embedded and intact', imported && (imported.cast || []).length === 6 && Object.keys(imported.castData || {}).length === 6, `${(imported?.cast || []).length} cast`);
    check('secret spring survived', imported && Object.values(imported.locations).some(l => l.secret === 2));

    // ---- play the import ----
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-reborn')); await wait(25000);
    const state = await page.evaluate(() => { const s = window.rpgCustodianDebug.state(); return { active: s.isActive, world: s.worldData?.worldId, roster: (s.npcRoster || []).length }; });
    check('imported world plays (cast materialized)', state.active && state.world === 'prototype-reborn' && state.roster === 6, JSON.stringify(state));

    // cleanup
    await page.evaluate(async () => {
        const s = SillyTavern.getContext().extensionSettings['rpg-custodian'];
        delete s.authoredWorlds['prototype-reborn'];
        delete s.authoredWorlds['prototype-town'];   // materialized by export
        await window.rpgCustodianDebug.refreshWorlds();
        SillyTavern.getContext().saveSettingsDebounced();
    });
    rmSync(DL, { recursive: true, force: true });

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
