// NL confirmation: at 🌕 peak an open (high-affection) NPC speaks to her
// fertile state from her context block. (Ebb + mobile: fertility-ebb-probe.js
// — the ebb ask needs a FRESH chat, or peak-flirtation momentum taints it.)
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const ask = async (text) => {
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 45; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(3000);
    return page.evaluate(() => [...SillyTavern.getContext().chat].reverse().find(m => m.name === 'Bryony' && !m.is_system)?.mes || '');
};

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1200);

    // to 🌕 peak, warm and open
    const peak = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const delta = ((4 - d.cycle('Bryony').step) % 8 + 8) % 8;
        if (delta) d.tick(delta * 4);
        d.player().relationships['Bryony'].affection = 7;
        return d.cycle('Bryony');
    });
    console.log('at peak:', JSON.stringify(peak));
    const rPeak = await ask(`Bryony, love, be honest with me — is today one of your fertile days?`);
    console.log('--- PEAK reply:\n' + rPeak + '\n');
    check('peak: she speaks to being fertile/at her peak', /fertile|peak|full[- ]?moon|ripe|heat|likely to (catch|take|conceive)|could (catch|conceive)|best day|good day/i.test(rPeak), rPeak.slice(0, 120));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
