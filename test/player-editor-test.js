// Player character editor: stat/pool/purse edits persist; the bespoke-status
// forge asks the Custodian and applies the result; throbber shows while
// forging; mobile panel on-screen.
import { connect, collectLogs, login, useMobileViewport } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const openMenuItem = async (label) => {
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(l => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes(l))?.click(), label);
    await wait(600);
};

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await openMenuItem('Create Character'); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(18000);

    // ---- open, edit numbers, save ----
    await openMenuItem('Edit Character');
    check('editor opens', await page.evaluate(() => !!document.getElementById('rpg-player-overlay')));
    await page.evaluate(() => {
        document.getElementById('pe-charm').value = '5';
        document.getElementById('pe-gold').value = '123';
        document.getElementById('pe-tokens').value = '7';
        document.getElementById('pe-xp').value = '450';
        document.getElementById('pe-stam').value = '1';
    });
    await page.click('#pe-save'); await wait(600);
    const rd = await page.evaluate(() => { const r = window.rpgCustodianDebug.player(); return { charm: r.stats.charm, gold: r.inventory.currency, tokens: r.stats.power_tokens, xp: r.stats.experience, stam: r.stats.stamina }; });
    check('edits persist', rd.charm === 5 && rd.gold === 123 && rd.tokens === 7 && rd.xp === 450 && rd.stam === 1, JSON.stringify(rd));

    // ---- forge a bespoke status ----
    await openMenuItem('Edit Character');
    const beforeFx = await page.evaluate(() => (window.rpgCustodianDebug.player().customEffects || []).length);
    await page.type('#pe-status-req', 'A traveler\'s blessing from an old shrine: +1 charm and +1 craftiness until the next dawn.');
    await page.click('#pe-forge');
    await wait(400);
    const throbberVisible = await page.evaluate(() => document.getElementById('pe-throbber')?.style.display !== 'none');
    check('throbber shows while forging', throbberVisible);
    for (let i = 0; i < 30; i++) { await wait(1000); const done = await page.evaluate(() => document.getElementById('pe-throbber')?.style.display === 'none'); if (done) break; }
    const fx = await page.evaluate(() => (window.rpgCustodianDebug.player().customEffects || []).map(e => ({ name: e.name, mods: e.mods, dur: e.expiresStep != null })));
    console.log('effects:', JSON.stringify(fx).slice(0, 240));
    check('forged effect applied', fx.length > beforeFx);
    const forged = fx[fx.length - 1];
    check('effect has substance (mods or duration)', !!forged && ((forged.mods || []).length > 0 || forged.dur));
    const resultLine = await page.evaluate(() => document.getElementById('pe-forge-result')?.textContent || '');
    check('result line shown in panel', /applied/.test(resultLine), resultLine.slice(0, 60));

    // ---- remove control clears the forged status ----
    const listed = await page.evaluate(() => document.querySelectorAll('#pe-effects .pe-fx-row').length);
    check('effects listed with remove controls', listed > 0, `rows=${listed}`);
    await page.evaluate(() => { const rows = document.querySelectorAll('#pe-effects .pe-fx-row'); rows[rows.length - 1]?.querySelector('.pe-fx-del')?.click(); });
    await wait(400);
    const fxAfter = await page.evaluate(() => (window.rpgCustodianDebug.player().customEffects || []).length);
    check('remove control dispels the status', fxAfter === beforeFx, `count=${fxAfter}`);

    // ---- inventory editor: add (Custodian-appraised) + remove ----
    await page.type('#pe-item-name', 'shimmering opal pendant');
    await page.click('#pe-item-add');
    let item2 = null;
    for (let i = 0; i < 30; i++) { await wait(1000); item2 = await page.evaluate(() => (window.rpgCustodianDebug.player().inventory.items || []).find(x => /opal/i.test(x.name))); if (item2?.effectText) break; }
    console.log('inv item:', JSON.stringify(item2 || {}).slice(0, 160));
    check('inventory add + Custodian appraisal', !!item2?.effectText, item2?.effectText);
    check('appraised effect shows in list', await page.evaluate(() => [...document.querySelectorAll('#pe-inv .pe-fx-label')].some(e => /opal/i.test(e.textContent) && !/appraising/.test(e.textContent))));
    await page.evaluate(() => { const rows = [...document.querySelectorAll('#pe-inv .pe-fx-row')]; const r = rows.find(x => /opal/i.test(x.textContent)); r?.querySelector('.pe-fx-del')?.click(); });
    await wait(400);
    check('inventory remove control works', await page.evaluate(() => !(window.rpgCustodianDebug.player().inventory.items || []).some(x => /opal/i.test(x.name))));
    await page.evaluate(() => document.getElementById('pe-close')?.click());

    // ---- mobile ----
    const page2 = await browser.newPage();
    page2.on('dialog', async d => await d.accept(''));
    await page2.setCacheEnabled(false);
    await useMobileViewport(page2);
    await login(page2);
    await page2.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await wait(2000);
    await page2.tap('#rpg-menu-button'); await wait(500);
    await page2.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Edit Character'))?.click()); await wait(700);
    const rect = await page2.evaluate(() => { const p = document.querySelector('#rpg-player-overlay .rpg-form-panel'); if (!p) return null; const r = p.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
    console.log('mobile rect:', JSON.stringify(rect));
    check('mobile: editor panel fully on-screen', !!rect && rect.l >= 0 && rect.t >= 0 && rect.r <= rect.vw && rect.b <= rect.vh);
    await page2.screenshot({ path: 'screenshots/player-editor-mobile.png' });
    await page2.close();

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
