// Day-of-week system:
//  1. a fresh game anchors Day 1 to the REAL-LIFE current weekday
//  2. weekday derives from dayCount and advances with the clock
//  3. it prints wherever Day N prints (banners, new-day message)
//  4. it rides the NPC scene anchor — an NPC can answer "what day is it?"
//  5. it persists in the save; legacy saves (no startWeekday) backfill so
//     today-in-game lands on the real-life weekday
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const today = new Date().getDay();
const todayName = WEEKDAYS[today];
const tomorrowName = WEEKDAYS[(today + 1) % 7];
const lastMessages = (n = 6) => page.evaluate((k) => (SillyTavern.getContext().chat || []).slice(-k).map(m => `${m.name}: ${m.mes}`), n);

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }

    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    // 1. fresh game anchors to the real-life weekday
    const anchor = await page.evaluate(() => ({ sw: window.rpgCustodianDebug.state().startWeekday, day: window.rpgCustodianDebug.state().dayCount, name: window.rpgCustodianDebug.weekday() }));
    check('fresh game anchors startWeekday to real-life today', anchor.sw === today && anchor.day === 1, JSON.stringify(anchor));
    check(`Day 1 is ${todayName}`, anchor.name === todayName, anchor.name);

    // 3a. New Game banner prints the weekday
    const banner = (await lastMessages(8)).find(m => m.includes('New Game Started')) || '';
    check('New Game banner prints Day 1 + weekday', banner.includes(`Day 1 (${todayName})`), banner.slice(0, 160));

    // 2. weekday advances with the clock (4 periods = next day)
    await page.evaluate(() => window.rpgCustodianDebug.tick(4)); await wait(1500);
    const d2 = await page.evaluate(() => ({ day: window.rpgCustodianDebug.state().dayCount, name: window.rpgCustodianDebug.weekday() }));
    check('next day = next weekday', d2.day === 2 && d2.name === tomorrowName, JSON.stringify(d2));

    // 5a. the save carries the anchor
    const savedSw = await page.evaluate(() => SillyTavern.getContext().extensionSettings['rpg-custodian']?.currentSave?.startWeekday);
    check('save persists startWeekday', savedSw === today, String(savedSw));

    // 4. NL: an NPC answers "what day is it?" from the scene anchor.
    // Find someone actually present to address.
    const present = await page.evaluate(() => {
        const st = window.rpgCustodianDebug.state();
        const names = ['Bryony', 'Fern', 'Marta', 'Seline', 'Sylvara', 'Wren'];
        const msgs = (SillyTavern.getContext().chat || []).map(m => m.mes).join('\n');
        const line = msgs.split('\n').reverse().find(l => l.includes('here') || l.includes('👥')) || msgs;
        return names.find(n => line.includes(n)) || names.find(n => msgs.includes(n)) || null;
    });
    check('found a present NPC to ask', !!present, String(present));
    if (present) {
        // type for REAL (debug act() doesn't insert the user message into chat)
        await page.type('#send_textarea', `${present}, quick question — what day of the week is it today?`);
        await page.keyboard.press('Enter');
        let sb = false;
        for (let i = 0; i < 45; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
        await wait(3000);
        const reply = (await lastMessages(4)).filter(m => m.startsWith(`${present}:`)).pop() || '';
        check(`NPC answers with the correct weekday (${tomorrowName})`, reply.includes(tomorrowName), reply.slice(0, 160));
        // the scene anchor she read from
        const anchorLine = await page.evaluate(() => SillyTavern.getContext().extensionPrompts?.['RPG_CUSTODIAN_STATUS']?.value?.split('\n')[0] || '');
        check('scene anchor states today\'s weekday', anchorLine.includes(`today is ${tomorrowName}`), anchorLine.slice(0, 140));
    }

    // 5b. legacy save backfill: strip startWeekday, set day 5 → on load,
    // today-in-game must land on the real-life weekday
    await page.evaluate(() => {
        const s = SillyTavern.getContext().extensionSettings['rpg-custodian'];
        for (const sv of [s.currentSave, s.saves?.['prototype-town']]) { if (sv) { delete sv.startWeekday; sv.day = 5; } }
        SillyTavern.getContext().saveSettingsDebounced();
    });
    await page.evaluate(() => window.rpgCustodianDebug.continueGame('prototype-town')); await wait(15000);
    const legacy = await page.evaluate(() => ({ day: window.rpgCustodianDebug.state().dayCount, sw: window.rpgCustodianDebug.state().startWeekday, name: window.rpgCustodianDebug.weekday() }));
    check('legacy save backfills: today-in-game = real-life today', legacy.day === 5 && legacy.name === todayName, JSON.stringify(legacy));
    const loadBanner = (await lastMessages(4)).find(m => m.includes('Game Loaded')) || '';
    check('Game Loaded banner prints Day 5 + weekday', loadBanner.includes(`Day 5 (${todayName})`), loadBanner.slice(0, 160));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
