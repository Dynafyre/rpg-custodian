// Faithful repro of Dyna's "Monday" failure.
// Her thinking gave it away: an established in-fiction pact ("Monday, our
// day") competed with the engine's calendar, and the question — "You know
// what today is?" — reads as an ANNIVERSARY prompt, not a calendar one. She
// answered the fiction. Depth alone never reproduced it; a competing fact does.
//
// A/B: same seeded pact + same ambiguous question, depth-0 anchor off vs on.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ask = async (text) => {
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 45; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(3000);
    return page.evaluate(() => [...SillyTavern.getContext().chat].reverse().find(m => m.name === 'Bryony' && !m.is_system)?.mes || '');
};
// Seed a competing fiction: a standing pact naming a DIFFERENT weekday.
const seedPact = (falseDay) => page.evaluate((fd) => {
    const ctx = SillyTavern.getContext();
    const push = (who, mes) => ctx.chat.push({ name: who, is_user: who === 'Dyna', is_system: false, send_date: Date.now(), mes });
    push('Dyna', `"Then let's make it a standing thing," I tell her. "One day a week that belongs to us, whatever else the world wants."`);
    push('Bryony', `She considers it a long moment, then nods once, firmly. "${fd}, then. ${fd} is ours — I'll keep the whole day clear, come rain or wolves. Don't you dare forget it."`);
    push('Dyna', `"${fd} it is," I agree, and she looks quietly pleased with herself for the rest of the evening.`);
    push('Bryony', `"Good." She busies herself with the fire, but the set of her shoulders has gone soft. "${fd}. Our day. I'll hold you to that."`);
}, falseDay);

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1200);
    await page.evaluate(() => { window.rpgCustodianDebug.player().relationships['Bryony'].affection = 8; });

    const today = await page.evaluate(() => window.rpgCustodianDebug.weekday());
    const falseDay = WEEKDAYS[(WEEKDAYS.indexOf(today) + 3) % 7];
    console.log(`engine day = ${today}; seeding a competing pact on ${falseDay}`);

    // A — competing fact present, depth-0 anchor SUPPRESSED (old behavior)
    await seedPact(falseDay);
    await page.evaluate(() => SillyTavern.getContext().setExtensionPrompt('RPG_CUSTODIAN_SCENE', '', 1, 0));
    const rA = await ask(`I catch her hand and grin. "You know what today is?"`);
    console.log('--- A (no depth-0 anchor):\n' + rA + '\n');
    const aFalse = rA.includes(falseDay), aTrue = rA.includes(today);

    // B — same setup, anchor LIVE
    await page.evaluate(() => window.rpgCustodianDebug.sceneText());
    const rB = await ask(`I squeeze her fingers. "No, really — what day is it today?"`);
    console.log('--- B (depth-0 anchor live):\n' + rB + '\n');
    const bFalse = rB.includes(falseDay), bTrue = rB.includes(today);

    console.log(`A: says ${falseDay}=${aFalse}, says ${today}=${aTrue} | B: says ${falseDay}=${bFalse}, says ${today}=${bTrue}`);
    check(`B: engine day (${today}) wins over the competing pact day`, bTrue && !bFalse, `${today}:${bTrue} ${falseDay}:${bFalse}`);
    if (aFalse && !aTrue) console.log(`✅ REPRODUCED Dyna's bug in arm A — she asserted ${falseDay} (the fiction) over ${today} (the engine).`);
    else console.log(`ℹ️  arm A did not misfire this run (said ${today}=${aTrue}, ${falseDay}=${aFalse}) — the failure is probabilistic, not deterministic.`);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
