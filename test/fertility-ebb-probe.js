// Isolate the ebb answer: FRESH game (no peak-flirtation momentum in chat),
// Bryony at 🌑 dark-moon, warm affection, direct question. Plus the mobile
// form pass that crashed in the last probe.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1200);

    const ebb = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const delta = ((0 - d.cycle('Bryony').step) % 8 + 8) % 8;
        if (delta) d.tick(delta * 4);
        d.player().relationships['Bryony'].affection = 7;
        return d.cycle('Bryony');
    });
    console.log('at ebb (fresh chat):', JSON.stringify(ebb));
    await page.type('#send_textarea', `Bryony, love — I've been thinking about children. Could we make one today, if we tried?`);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 45; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(3000);
    const reply = await page.evaluate(() => [...SillyTavern.getContext().chat].reverse().find(m => m.name === 'Bryony' && !m.is_system)?.mes || '');
    console.log('--- EBB reply:\n' + reply + '\n');
    check('fresh-scene ebb: she answers barren-side', /barren|not fertile|infertile|won'?t (catch|take)|wouldn'?t (catch|take)|no chance|dark[- ]?moon|ebb|not today|wrong (day|time)|safe day|nothing would come|can'?t conceive|couldn'?t conceive|body says no|moon'?s dark/i.test(reply), reply.slice(0, 140));

    // mobile form pass. setViewport(isMobile) RELOADS the page — wait for the
    // extension to re-initialize before touching its globals.
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    for (let i = 0; i < 20; i++) { if (await page.evaluate(() => !!window.rpgCustodianDebug).catch(() => false)) break; await wait(2000); }
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        ctx.extensionSettings['rpg-custodian'] = ctx.extensionSettings['rpg-custodian'] || {};
        const s = ctx.extensionSettings['rpg-custodian'];
        s.authoredWorlds = s.authoredWorlds || {};
        delete s.authoredWorlds['cycle-proof-m'];
        s.authoredWorlds['cycle-proof-m'] = { worldId: 'cycle-proof-m', name: 'CPM', description: 'x', startingLocation: 'a', locations: { a: { name: 'A', description: 'x', connections: [], background: '' } }, cast: [], castData: {} };
        ctx.saveSettingsDebounced();
        await window.rpgCustodianDebug.refreshWorlds();
        window.rpgCustodianDebug.adoptCast('cycle-proof-m', 'Trizel');
        window.rpgCustodianDebug.castForm('cycle-proof-m', 'Trizel');
    });
    await wait(700);
    const mob = await page.evaluate(() => {
        const out = {};
        for (const id of ['cf-fert', 'cf-fert-calc', 'cf-womb', 'cf-pregs', 'cf-prog']) {
            const r = document.getElementById(id)?.getBoundingClientRect();
            out[id] = r ? { onX: r.left >= 0 && r.right <= 390, w: Math.round(r.width) } : null;
        }
        return out;
    });
    check('mobile: new fields on-screen (no x-overflow)', Object.values(mob).every(v => v && v.onX), JSON.stringify(mob));
    await page.evaluate(() => { $('#cf-fert').val(15).trigger('input'); }); await wait(600);
    const mCalc = await page.evaluate(() => document.querySelector('#cf-fert-calc')?.textContent || '');
    check('mobile: debounced calc updates', mCalc.includes('peak 55%'), mCalc.slice(0, 50));
    await page.evaluate(async () => {
        $('#cf-cancel').trigger('click');
        const ctx = SillyTavern.getContext();
        delete ctx.extensionSettings['rpg-custodian'].authoredWorlds['cycle-proof-m'];
        await window.rpgCustodianDebug.refreshWorlds();
        ctx.saveSettingsDebounced();
    });

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
