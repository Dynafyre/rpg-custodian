// Secret-location travel reliability (Dyna's bush-tunnel repro):
//  1. resolver: synonym descriptors route by token overlap — "the secret
//     spring" → Moonlit Spring (no shared substring, shared noun)
//  2. resolver: zero-overlap names still refuse (no false positives)
//  3. emergent NL: entering a secret place via its concealed entrance,
//     called by a NON-listed name, must actually MOVE the engine
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const loc = () => page.evaluate(() => window.rpgCustodianDebug.state().currentLocation);

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(18000);

    // 1. synonym-descriptor resolution ("secret" vs "Moonlit") from across the map
    await page.evaluate(() => window.rpgCustodianDebug.teleport('town-square')); await wait(800);
    await page.evaluate(() => window.rpgCustodianDebug.nlMove('the secret spring')); await wait(3000);
    check('"the secret spring" routes to Moonlit Spring (multi-hop)', (await loc()) === 'moonlit-spring', await loc());

    // 2. zero-overlap stays put with the 🚫 note
    await page.evaluate(() => window.rpgCustodianDebug.teleport('town-square')); await wait(800);
    await page.evaluate(() => window.rpgCustodianDebug.nlMove('the crystal caverns')); await wait(2000);
    check('unknown place still refuses (no false positive)', (await loc()) === 'town-square', await loc());

    // 3. emergent: concealed entrance + non-listed name, full NL turn
    await page.evaluate(() => window.rpgCustodianDebug.teleport('forest')); await wait(800);
    const before = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', 'I part the curtain of ferns behind the old willow and slip down the hidden path into the secret spring.');
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 70; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2000);
    const intent = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('intent:', intent.replace(/^.*intent = /, '').replace(/\s+/g, ' ').slice(0, 260));
    check('Custodian emitted the move', /"type":\s*"move"/.test(intent));
    check('engine actually traveled to the secret place', (await loc()) === 'moonlit-spring', await loc());
    const travelMsg = await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).filter(m => /🚶/.test(m.mes)).map(m => m.mes).join(' '), before);
    check('🚶 travel notice printed', /Moonlit Spring/.test(travelMsg), travelMsg.slice(0, 80));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
