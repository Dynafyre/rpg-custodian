// Focused iteration harness for the betrayal→emotional-wound calibration.
// One NL turn: an unambiguous witnessed betrayal must yield an affection-
// wounding status (or a judge drop) on Wren. Full coverage lives in
// narrative-status-test.js.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
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
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(18000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('shop')); await wait(1200);
    await page.evaluate(() => window.rpgCustodianDebug.setAffection('Wren', 6));
    const before = await page.evaluate(() => window.rpgCustodianDebug.npcEff('Wren'));

    await page.type('#send_textarea', `I snatch the coin purse from Wren's counter — her week's takings — and pocket it right in front of her, meeting her eyes as I do it, daring her to do anything about it.`);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 70; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2500);

    const intent = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('intent:', intent.replace(/^.*intent = /, '').replace(/\s+/g, ' ').slice(0, 500));
    const after = await page.evaluate(() => window.rpgCustodianDebug.npcEff('Wren'));
    const wound = await page.evaluate(() => (window.rpgCustodianDebug.statuses('Wren') || []).filter(e => (e.mods || []).some(m => m.stat === 'affection')).map(e => ({ name: e.name, mods: e.mods, end: e.endCondition })));
    console.log('aff:', before.aff, '→', after.aff, 'wound:', JSON.stringify(wound));
    check('betrayal wounded her (affection status or drop)', wound.length >= 1 || after.aff < before.aff);
    if (wound.length) check('wound ends on amends', wound.some(w => !!w.end), JSON.stringify(wound.map(w => w.end)));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
