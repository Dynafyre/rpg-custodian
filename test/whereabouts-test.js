// Whereabouts knowledge (Custodian-gated): asking Wren where Bryony is
// emits the whereabouts verb; the engine hands her honest schedule
// knowledge; her answer names Bryony's actual current location. Secret
// locations are never leaked ("nobody's quite sure").
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

    const expected = await page.evaluate(() => {
        const s = window.rpgCustodianDebug.state();
        const period = ['Morning', 'Day', 'Evening', 'Night'][s.currentTime];
        const b = (s.npcRoster || []).find(n => n.name === 'Bryony');
        const locId = b?.schedule?.[period] ?? b?.homeLocation;
        return { locId, locName: s.worldData.locations[locId]?.name || locId, period };
    });
    console.log('Bryony should be at:', JSON.stringify(expected));

    const s0 = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', '"Say, Wren — where would I find Bryony at this hour?" I ask.');
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 55; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2000);

    const intent = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('intent:', intent.replace(/^.*intent = /, '').slice(0, 200));
    check('Custodian emitted whereabouts', /"type":\s*"whereabouts"/.test(intent));
    const wren = await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).filter(m => !m.is_user && !m.is_system && m.name === 'Wren').map(m => m.mes).join(' '), s0);
    console.log('Wren:', wren.replace(/\s+/g, ' ').slice(0, 220));
    const locRegex = new RegExp(expected.locName.split(' ').pop(), 'i');
    check("Wren names Bryony's actual location", locRegex.test(wren), `expected ~"${expected.locName}"`);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
