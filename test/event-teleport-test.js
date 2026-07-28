// event_teleport: story-driven translocation to a NODE-ISOLATED location
// (no connecting paths — Florence's pocket-dimension case).
//  1. walking there refuses (no route)
//  2. engine teleport lands there, with background/presence/notice
//  3. companions ride along (party presence at the isolated node)
//  4. emergent NL: accepting an entity's spiriting-away emits the verb
//  5. teleporting back out works too
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

    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        const s = ctx.extensionSettings['rpg-custodian'];
        if (s?.authoredWorlds?.['teleport-proof']) delete s.authoredWorlds['teleport-proof'];
        s.authoredWorlds = s.authoredWorlds || {};
        s.authoredWorlds['teleport-proof'] = {
            worldId: 'teleport-proof', name: 'Teleport Proof', description: 'pocket-dimension test world',
            startingLocation: 'square',
            locations: {
                square: { name: 'Village Square', description: 'A modest cobbled square.', connections: [], background: '' },
                pocket: { name: 'The Velvet Void', description: 'A warm, dark, womb-like void between spaces.', connections: [], secret: 2, background: '' },
            },
            cast: [], castData: {},
        };
        ctx.saveSettingsDebounced();
        await window.rpgCustodianDebug.refreshWorlds();
    });
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.adoptCast('teleport-proof', 'Trizel'));
    await page.evaluate(() => window.rpgCustodianDebug.newGame('teleport-proof')); await wait(20000);

    // 1. no route on foot
    await page.evaluate(() => window.rpgCustodianDebug.nlMove('the velvet void')); await wait(2000);
    check('walking to the isolated node refuses', (await loc()) === 'square', await loc());

    // 2 + 3. engine teleport with a companion
    await page.evaluate(() => window.rpgCustodianDebug.addParty('Trizel')); await wait(1000);
    await page.evaluate(() => window.rpgCustodianDebug.eventTeleport('the velvet void')); await wait(2500);
    check('teleport lands at the isolated node', (await loc()) === 'pocket', await loc());
    const notice = await page.evaluate(() => [...SillyTavern.getContext().chat].reverse().find(m => /🌀/.test(m.mes))?.mes || '');
    check('🌀 spirited-away notice printed', /Velvet Void/.test(notice), notice.slice(0, 70));
    check('companion rode along (present in the void)', /Trizel/.test(await page.evaluate(() => window.rpgCustodianDebug.analyzerNpcs())));

    // 5-pre: teleport back out (isolated both ways)
    await page.evaluate(() => window.rpgCustodianDebug.eventTeleport('village square')); await wait(2000);
    check('teleport back out works', (await loc()) === 'square', await loc());

    // 4. emergent NL: accept the spiriting-away
    const before = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', `"Yes — show me," I breathe, taking Trizel's offered hand. The square folds away around us like dark cloth as she spirits us bodily into her velvet void between spaces.`);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 70; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2000);
    const intent = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('intent:', intent.replace(/^.*intent = /, '').replace(/\s+/g, ' ').slice(0, 240));
    check('Custodian emitted event_teleport', /"type":\s*"event_teleport"/.test(intent));
    check('engine landed in the void', (await loc()) === 'pocket', await loc());

    // cleanup
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        delete ctx.extensionSettings['rpg-custodian'].authoredWorlds['teleport-proof'];
        await window.rpgCustodianDebug.refreshWorlds();
        ctx.saveSettingsDebounced();
    });

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
