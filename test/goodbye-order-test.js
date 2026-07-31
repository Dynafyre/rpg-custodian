// Dyna's sequencing bug: "say goodbye to an NPC, then change location".
// Effects (including the move) all ran before anyone replied, and the reply
// stage then refused to trigger her because she was no longer present — so her
// farewell was dropped silently, in both orderings.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

const act = async (text) => {
    const from = await page.evaluate(() => (SillyTavern.getContext().chat || []).length);
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 60; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(3000);
    return page.evaluate((f) => (SillyTavern.getContext().chat || []).slice(f).map(m => ({ who: m.is_user ? 'you' : (m.is_system ? 'sys' : m.name), mes: (m.mes || '').replace(/\s+/g, ' ') })), from);
};

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    // ── goodbye THEN leave ────────────────────────────────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);
    const tail1 = await act(`"Take care of yourself, Bryony," I say, clasping her shoulder. Then I set off for the town square.`);
    for (const m of tail1) console.log(`  [${m.who}] ${m.mes.slice(0, 150)}`);
    const bryonySpoke = tail1.some(m => m.who === 'Bryony' && m.mes.length > 20);
    const moved1 = await page.evaluate(() => window.rpgCustodianDebug.state().currentLocation);
    check('goodbye-then-leave: she actually answers', bryonySpoke);
    check('goodbye-then-leave: the move still happens', moved1 !== 'outskirts', moved1);
    if (bryonySpoke) {
        const iBry = tail1.findIndex(m => m.who === 'Bryony');
        // only the ENGINE's travel notice counts — the player's own message
        // naturally mentions setting off and would match first
        const iArrive = tail1.findIndex(m => m.who !== 'you' && /🚶/.test(m.mes));
        check('goodbye-then-leave: she speaks BEFORE the arrival', iArrive === -1 || iBry < iArrive, `bryony@${iBry} arrival@${iArrive}`);
    }

    // ── leave THEN goodbye (the mirror phrasing) ──────────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);
    const tail2 = await act(`I start walking toward the woods, calling back over my shoulder — "See you tonight, Bryony!"`);
    for (const m of tail2) console.log(`  [${m.who}] ${m.mes.slice(0, 150)}`);
    check('leave-then-goodbye: she is still given her line', tail2.some(m => m.who === 'Bryony' && m.mes.length > 20));

    // ── the ordinary case is untouched: nobody speaks twice ───────────────
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);
    const tail3 = await act(`"Morning, Bryony. Anything stirring on the trails?"`);
    const bryonyCount = tail3.filter(m => m.who === 'Bryony').length;
    check('a plain conversation still gets exactly one reply', bryonyCount === 1, `${bryonyCount} replies`);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
