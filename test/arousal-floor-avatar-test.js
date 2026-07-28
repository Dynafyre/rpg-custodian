// Two refinements in one session (portrait-proof world + Trizel):
//  A. arousal floor is now 0 (consistent with affection): sets, decay-to-0,
//     and a cap:0 status all bottom out at 0
//  B. tapping a cast member's in-chat avatar opens her cast editor with a
//     portrait header + fullscreen toggle; cancel closes outright (quick
//     mode); non-cast avatars (GM) keep vanilla behavior
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const aro = () => page.evaluate(() => window.rpgCustodianDebug.npcEff('Trizel').aro);

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }

    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        const s = ctx.extensionSettings['rpg-custodian'];
        if (s?.authoredWorlds?.['portrait-proof']) delete s.authoredWorlds['portrait-proof'];
        s.authoredWorlds = s.authoredWorlds || {};
        s.authoredWorlds['portrait-proof'] = {
            worldId: 'portrait-proof', name: 'Portrait Proof', description: 'avatar-tap test world',
            startingLocation: 'square',
            locations: { square: { name: 'Test Square', description: 'A bare little square.', connections: [], background: '' } },
            cast: [], castData: {},
        };
        ctx.saveSettingsDebounced();
        await window.rpgCustodianDebug.refreshWorlds();
    });
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.adoptCast('portrait-proof', 'Trizel'));
    await page.evaluate(() => window.rpgCustodianDebug.newGame('portrait-proof')); await wait(20000);

    // ---- A. floor 0 ----
    await page.evaluate(() => window.rpgCustodianDebug.setArousal('Trizel', 0));
    check('setArousal(0) holds at 0', (await aro()) === 0, `aro=${await aro()}`);
    await page.evaluate(() => window.rpgCustodianDebug.setArousal('Trizel', 3));
    await page.evaluate(() => window.rpgCustodianDebug.tick(1));
    check('decay 3 → 1', (await aro()) === 1, `aro=${await aro()}`);
    await page.evaluate(() => window.rpgCustodianDebug.tick(1));
    check('decay 1 → 0 (reaches the floor)', (await aro()) === 0, `aro=${await aro()}`);
    await page.evaluate(() => window.rpgCustodianDebug.tick(1));
    check('floor holds at 0', (await aro()) === 0, `aro=${await aro()}`);
    await page.evaluate(() => { window.rpgCustodianDebug.setArousal('Trizel', 5); window.rpgCustodianDebug.addStatus('Trizel', { name: 'Numbing Ward', kind: 'curse', polarity: 'negative', desc: 'all desire sealed', mods: [{ stat: 'arousal', cap: 0 }], duration: 2 }); });
    check('cap:0 seals effective arousal at 0', (await aro()) === 0, `aro=${await aro()}`);
    await page.evaluate(() => window.rpgCustodianDebug.tick(3));   // let the ward expire, clean state

    // ---- B. avatar tap → cast editor ----
    const before = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', '"Trizel! Over here — how are you finding the square today?" I call, waving her over.');
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 70; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2000);
    const hasMsg = await page.evaluate(() => !!document.querySelector('#chat .mes[ch_name="Trizel"] .avatar'));
    check('Trizel replied with an avatar in chat', hasMsg);

    await page.evaluate(() => { const a = [...document.querySelectorAll('#chat .mes[ch_name="Trizel"] .avatar')].pop(); a?.click(); });
    await wait(700);
    check('avatar tap opened her cast editor', await page.evaluate(() => !!document.querySelector('#rpg-cast-overlay #cf-role')));
    check('portrait shown above the form', await page.evaluate(() => { const i = document.querySelector('#cf-portrait'); return !!i && i.src.includes('characters'); }));

    await page.evaluate(() => document.querySelector('#cf-portrait')?.click()); await wait(400);
    check('portrait tap → fullscreen', await page.evaluate(() => !!document.querySelector('.cf-portrait-fs')));
    await page.evaluate(() => document.querySelector('.cf-portrait-fs')?.click()); await wait(400);
    check('fullscreen tap closes it', await page.evaluate(() => !document.querySelector('.cf-portrait-fs')));

    await page.evaluate(() => document.querySelector('#cf-cancel')?.click()); await wait(500);
    check('cancel closes outright (quick mode, no cast list)', await page.evaluate(() => !document.querySelector('#rpg-cast-overlay')));

    await page.evaluate(() => { const a = [...document.querySelectorAll('#chat .mes[ch_name="Game Master"] .avatar')].pop(); a?.click(); });
    await wait(600);
    check('GM avatar keeps vanilla behavior (no cast editor)', await page.evaluate(() => !document.querySelector('#rpg-cast-overlay')));
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));   // dismiss any vanilla zoom

    // cleanup
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        delete ctx.extensionSettings['rpg-custodian'].authoredWorlds['portrait-proof'];
        await window.rpgCustodianDebug.refreshWorlds();
        ctx.saveSettingsDebounced();
    });

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
