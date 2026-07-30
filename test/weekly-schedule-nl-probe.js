// NL confirmation for weekly timetables: give Marta a working week with
// activity notes, then check she can answer (a) what she is doing right now,
// (b) what she does on a given weekday, and (c) on reunion, what she has been
// up to — all from her timetable, unprompted by the player naming it.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const ask = async (text, who = 'Marta') => {
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 50; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(3000);
    return page.evaluate((n) => [...SillyTavern.getContext().chat].reverse().find(m => m.name === n && !m.is_system)?.mes || '', who);
};

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    // Give the innkeeper a real working week, in the live roster
    const setup = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const npc = d.state().npcRoster.find(n => n.name === 'Marta');
        const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const wk = {};
        for (const day of WD) {
            const market = day === 'Saturday';
            wk[day] = {
                Morning: { loc: 'inn', note: market ? 'haggling for fish' : 'kneading bread dough' },
                Day: { loc: market ? 'shop' : 'inn', note: market ? 'buying the flour' : 'scrubbing the tap-room' },
                Evening: { loc: 'inn', note: 'pouring for the regulars' },
                Night: { loc: 'inn', note: 'counting the till' },
            };
        }
        npc.weeklyEnabled = true; npc.weeklySchedule = wk;
        d.player().relationships['Marta'] = d.player().relationships['Marta'] || { affection: 6, arousal: 0, familiarity: 0, pregnancies: 0, pregnancy_progress: 0 };
        d.player().relationships['Marta'].affection = 6;
        return { today: d.weekday(), slot: d.slot('Marta') };
    });
    console.log('today:', setup.today, '| her slot now:', JSON.stringify(setup.slot), '\n');

    await page.evaluate(() => window.rpgCustodianDebug.teleport('inn')); await wait(1500);

    // (a) what is she doing right now — asked obliquely, never naming the task
    const r1 = await ask(`I push through the inn door and spot her. "Busy morning, Marta? What's got you occupied?"`);
    console.log('--- current activity:\n' + r1 + '\n');
    check('she says what her timetable has her doing', /dough|knead|bread|fish|haggl/i.test(r1), (r1.match(/(dough|knead|bread|fish|haggl)\w*/i) || [''])[0]);

    // (b) her week — a weekday she is NOT currently living
    const r2 = await ask(`"Do your days all look the same, or does the week change on you?"`);
    console.log('--- her week:\n' + r2 + '\n');
    check('she can speak to her week varying by day', /saturday|market|flour|different|depends|varies|week/i.test(r2), (r2.match(/(saturday|market|flour|varies|depends)\w*/i) || [''])[0]);

    // (c) reunion: leave for two days, come back, she recounts real pursuits
    await page.evaluate(() => { window.rpgCustodianDebug.teleport('outskirts'); window.rpgCustodianDebug.tick(8); }); await wait(2000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('inn')); await wait(1500);
    const r3 = await ask(`"Marta! It's been a couple of days — what have I missed?"`);
    console.log('--- reunion:\n' + r3 + '\n');
    check('on reunion she recounts things her timetable actually had her doing', /dough|knead|bread|tap-?room|scrub|till|pour|regulars|fish|flour|market/i.test(r3), (r3.match(/(dough|knead|bread|tap-?room|scrub|till|pour|regulars|fish|flour|market)\w*/i) || [''])[0]);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
