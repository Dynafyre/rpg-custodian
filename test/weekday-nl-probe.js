// Probe: does a present NPC answer "what day is it?" with the right weekday?
// Runs against whatever game is currently loaded (expects Day 5 from the main
// test → weekday = real-life today). Prints full replies for inspection.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Continue'))?.click()); await wait(15000);

    const st = await page.evaluate(() => ({ day: window.rpgCustodianDebug.state().dayCount, name: window.rpgCustodianDebug.weekday() }));
    console.log('game day:', JSON.stringify(st));
    const expect = st.name;

    let pass = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
        // type for REAL — the debug act() hook skips inserting the user
        // message into the chat, so the NPC would never see the question
        await page.type('#send_textarea', `Bryony, humor me — I've lost track. What day of the week is it today?`);
        await page.keyboard.press('Enter');
        let sb = false;
        for (let i = 0; i < 45; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
        await wait(3000);
        const reply = await page.evaluate(() => {
            const c = SillyTavern.getContext().chat || [];
            return [...c].reverse().find(m => m.name === 'Bryony' && !m.is_system)?.mes || '';
        });
        const ok = reply.includes(expect);
        console.log(`--- attempt ${attempt}: ${ok ? '✅ says ' + expect : '❌ missing ' + expect}\n${reply}\n`);
        if (ok) pass++;
    }
    console.log(`${pass}/3 attempts named the correct weekday`);
    process.exitCode = pass >= 2 ? 0 : 1;
} finally { await page.close(); await browser.disconnect(); }
