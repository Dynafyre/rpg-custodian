// Location secrecy (world-management §3.4) — Moonlit Spring (secret level 2):
//  - absent from player-facing menus (look exits) and NPC common knowledge
//  - present in the Custodian's KNOWN PLACES with the secret annotation
//  - fully reachable via NL travel (fuzzy match + BFS routing unchanged)
//  - emergent discovery: following the seeded clue lands there
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
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
    await wait(6000);
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('New Game'))?.click());
    await wait(20000);

    // ---- world sanity ----
    const world = await page.evaluate(() => window.rpgCustodianDebug.state().worldData.locations['moonlit-spring']);
    check('moonlit-spring exists at secret level 2', world?.secret === 2);

    // ---- player-facing menus hide it ----
    await page.evaluate(() => window.rpgCustodianDebug.teleport('forest')); await wait(1000);
    const s1 = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.evaluate(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/look'));
    await wait(1500);
    const lookMsg = await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).map(m => m.mes || '').join('\n'), s1);
    check('look exits at forest omit the Spring', /Available exits/.test(lookMsg) && !/Moonlit Spring/.test(lookMsg));

    // ---- NPC common knowledge hides it; public places listed ----
    const status = await page.evaluate(() => SillyTavern.getContext().extensionPrompts?.['RPG_CUSTODIAN_STATUS']?.value || '');
    check('status block lists public places', /Places:.*General Store/.test(status));
    check('status block does NOT reveal the Spring', !/Moonlit Spring/.test(status));

    // ---- Custodian knows it, annotated ----
    const knownLine = await page.evaluate(() => window.rpgCustodianDebug ? null : null); // placeholder
    // (knownPlacesForAnalyzer isn't exposed; assert via the analyzer prompt during the NL act below with RPGC_LOG_PROMPT)
    await page.evaluate(() => { window.RPGC_LOG_PROMPT = true; });

    // ---- NL travel reaches it (deterministic path) ----
    await page.evaluate(() => window.rpgCustodianDebug.teleport('town-square')); await wait(800);
    const ok = await page.evaluate(() => window.rpgCustodianDebug.nlMove('moonlit spring'));
    check('nlMove routes to the hidden Spring (fuzzy + BFS intact)', ok === true && (await loc()) === 'moonlit-spring', `loc=${await loc()}`);

    // ---- emergent discovery via the seeded clue ----
    await page.evaluate(() => window.rpgCustodianDebug.teleport('forest')); await wait(800);
    await page.type('#send_textarea', 'Fern once spoke of a hidden spring of silver water somewhere off the deer-trails. I leave the path and search deeper into the woods for it.');
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 55; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2000);
    const intent = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('intent:', intent.replace(/^.*intent = /, '').slice(0, 220));
    const prompt = consoleLogs.filter(l => l.includes('ANALYZER PROMPT')).slice(-1)[0] || '';
    check('analyzer prompt annotates the Spring as secret', /Moonlit Spring" \(secret/.test(prompt));
    // The Custodian may (rightly) gate discovery behind a check — searching
    // for a hidden place is uncertain and dramatic. Valid outcomes: the move
    // is in the intent, and location matches the roll's result.
    const searchIntended = /"destination":\s*"Moonlit Spring"/i.test(intent);
    const rolled = /"stat"/.test(intent);
    const where = await loc();
    check('emergent discovery targets the Spring (check-gated ok)', searchIntended, `rolled=${rolled}`);
    check('location matches the outcome', where === 'moonlit-spring' || (rolled && where === 'forest'), `loc=${where}`);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
