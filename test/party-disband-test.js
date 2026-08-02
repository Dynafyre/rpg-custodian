// Escorting someone somewhere has to MEAN something.
//
// Before: parting ways snapped a companion straight back onto her routine, so
// walking her to the inn and letting her go teleported her to wherever her
// schedule had her that period — the escort was undone the instant you finished
// it, and her farewell told you to find her at a place she was already leaving.
//
// After: she stays where you parted for the rest of the period, picks her
// routine back up on the NEXT time step, and her goodbye names where she'll be
// NEXT rather than where she is standing.
//
// Bryony's schedule is Morning=outskirts, Day=forest, Evening=town-square,
// Night=outskirts — she is never at the inn, so escorting her there is
// unambiguous.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const at = (loc) => page.evaluate((l) => window.rpgCustodianDebug.presence(l), loc);
const ghosts = () => page.evaluate(() => (SillyTavern.getContext().chat || []).filter(m => m.is_system && m.name === 'RPG Custodian').slice(-4).map(m => m.mes));
const settle = async () => { for (let i = 0; i < 40; i++) { if (!(await page.evaluate(() => window.rpgCustodianDebug.busy()))) return; await wait(1500); } };

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    const t0 = await page.evaluate(() => ({ time: window.rpgCustodianDebug.state().currentTime, loc: window.rpgCustodianDebug.state().currentLocation }));
    console.log('   start:', JSON.stringify(t0), '(0=Morning)');

    // ── escort her somewhere she never goes on her own ────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.addParty('Bryony')); await wait(800);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('inn')); await wait(1200);
    check('she travels with you to the inn', (await at('inn')).includes('Bryony'), JSON.stringify(await at('inn')));

    // ── part ways there ───────────────────────────────────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.removeParty('Bryony'));
    await settle(); await wait(1500);

    const inn = await at('inn'), outskirts = await at('outskirts');
    console.log('   after parting — inn:', JSON.stringify(inn), '· outskirts:', JSON.stringify(outskirts));
    check('she STAYS at the inn where you parted', inn.includes('Bryony'), JSON.stringify(inn));
    check('she does NOT snap back to her Morning slot', !outskirts.includes('Bryony'), JSON.stringify(outskirts));

    // Notices carry DISPLAY names, so assert on those: inn → "The Cozy Hearth
    // Inn", forest → "Whispering Woods".
    const names = await page.evaluate(() => {
        const L = window.rpgCustodianDebug.state().worldData.locations;
        return { inn: L['inn']?.name, forest: L['forest']?.name, outskirts: L['outskirts']?.name };
    });
    const said = (await ghosts()).find(m => /parts ways/.test(m)) || '';
    console.log('   ghost:', said);
    check('the notice says she stays where you parted', said.includes(`stays at ${names.inn}`), said);
    check('and names where she goes NEXT, not now', said.includes(names.forest) && /come Day/.test(said), said);
    check('it does not send you to her CURRENT slot', !said.includes(names.outskirts), said);

    const rel = await page.evaluate(() => { const r = window.rpgCustodianDebug.rel('Bryony'); return { partedAt: r.partedAt, partedStep: r.partedStep }; });
    check('the parting is recorded on her', rel.partedAt === 'inn' && rel.partedStep != null, JSON.stringify(rel));

    // ── time moves on: she picks her routine back up ──────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.tick(1)); await wait(1500);
    const innAfter = await at('inn'), forest = await at('forest');
    console.log('   next period — inn:', JSON.stringify(innAfter), '· forest:', JSON.stringify(forest));
    check('come the next period she is at her scheduled spot', forest.includes('Bryony'), JSON.stringify(forest));
    check('and no longer lingering at the inn', !innAfter.includes('Bryony'), JSON.stringify(innAfter));

    // ── re-joining clears the pin ─────────────────────────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.addParty('Bryony')); await wait(800);
    const cleared = await page.evaluate(() => { const r = window.rpgCustodianDebug.rel('Bryony'); return { partedAt: r.partedAt, partedStep: r.partedStep }; });
    check('travelling together again clears the lingering pin', !cleared.partedAt && !cleared.partedStep, JSON.stringify(cleared));

    // ── and the same thing driven from natural language ───────────────────
    // She is with you at the inn again, and it is now Day (her slot: the woods).
    await page.evaluate(async () => { await window.rpgCustodianDebug.act(`"Thanks for walking all this way with me, Bryony. I'll let you get back to your own business — see you around."`); });
    await settle(); await wait(1500);
    const nlParty = await page.evaluate(() => window.rpgCustodianDebug.state().party || []);
    const nlRel = await page.evaluate(() => { const r = window.rpgCustodianDebug.rel('Bryony'); return { partedAt: r.partedAt, partedStep: r.partedStep }; });
    const nlInn = await at('inn');
    const herLine = await page.evaluate(() => ([...(SillyTavern.getContext().chat || [])].reverse().find(m => m.name === 'Bryony')?.mes || '').replace(/\s+/g, ' ').slice(0, 300));
    console.log('   she said:', herLine);
    check('NL parting drops her from the party', !nlParty.includes('Bryony'), JSON.stringify(nlParty));
    check('NL parting leaves her where you parted, not on her routine', nlRel.partedAt === 'inn' && nlInn.includes('Bryony'), JSON.stringify({ nlRel, nlInn }));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
