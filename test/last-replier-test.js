// When a line names nobody the engine can resolve, the woman already holding
// the conversation answers — rather than the turn falling silent. She must
// still be present and awake to take it.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const turn = async (text) => {
    const from = await page.evaluate(() => (SillyTavern.getContext().chat || []).length);
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 60; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2500);
    return page.evaluate((f) => (SillyTavern.getContext().chat || []).slice(f).map(m => ({
        who: m.is_user ? 'you' : (m.is_system ? `sys:${m.name}` : m.name), mes: (m.mes || '').replace(/\s+/g, ' ').slice(0, 80),
    })), from);
};
const lastReplier = () => page.evaluate(() => window.rpgCustodianDebug.state().lastReplier);

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    // two women in the room so "nobody matched" is a real possibility
    await page.evaluate(() => {
        const d = window.rpgCustodianDebug, st = d.state();
        const here = st.currentLocation;
        const sched = { Morning: here, Day: here, Evening: here, Night: here };
        for (const n of st.npcRoster) if (['Marta', 'Wren'].includes(n.name)) { n.schedule = sched; n.homeLocation = here; n.nicknames = ['Auntie']; }
    });
    await page.evaluate(() => window.rpgCustodianDebug.teleport(window.rpgCustodianDebug.state().currentLocation)); await wait(1500);

    // 1. open a conversation with one of them by name
    let tail = await turn(`"Wren, what's the going rate for rope these days?"`);
    for (const m of tail) console.log(`   [${m.who}] ${m.mes}`);
    check('the named woman answers', tail.some(m => m.who === 'Wren'));
    check('she is remembered as holding the floor', (await lastReplier()) === 'Wren', String(await lastReplier()));

    // 2. carry on without naming her — she should keep the conversation
    tail = await turn(`"And if I wanted twice that much?"`);
    for (const m of tail) console.log(`   [${m.who}] ${m.mes}`);
    check('an unnamed follow-up goes to the woman already talking', tail.some(m => m.who === 'Wren'), JSON.stringify(tail.map(t => t.who)));
    check('the other woman does not butt in', !tail.some(m => m.who === 'Marta'), JSON.stringify(tail.map(t => t.who)));

    // 3. an ambiguous nickname both share → the one holding the floor takes it
    tail = await turn(`"Thanks, Auntie."`);
    for (const m of tail) console.log(`   [${m.who}] ${m.mes}`);
    check('an ambiguous name goes to whoever was already speaking', tail.some(m => m.who === 'Wren'), JSON.stringify(tail.map(t => t.who)));

    // 4. naming the other woman hands the floor over
    tail = await turn(`"Marta, could I trouble you for a room tonight?"`);
    for (const m of tail) console.log(`   [${m.who}] ${m.mes}`);
    check('naming someone else moves the conversation to her', tail.some(m => m.who === 'Marta'));
    check('the floor is now hers', (await lastReplier()) === 'Marta', String(await lastReplier()));

    // 5. leaving the room ends it — nobody trails after you
    const empty = await page.evaluate(() => {
        const d = window.rpgCustodianDebug, st = d.state();
        const P = ['Morning', 'Day', 'Evening', 'Night'][st.currentTime];
        return Object.keys(st.worldData.locations).find(id =>
            !(st.npcRoster || []).some(n => (n.schedule?.[P] ?? n.homeLocation) === id));
    });
    await page.evaluate((l) => window.rpgCustodianDebug.teleport(l), empty); await wait(1800);
    // (not "take stock of my supplies" — that reads as examining yourself, which
    //  prints the character sheet and correctly suppresses narration)
    tail = await turn(`I gather a few sticks and coax a small fire to life.`);
    for (const m of tail) console.log(`   [${m.who}] ${m.mes}`);
    check('alone, the absent woman does not answer from another room',
        !tail.some(m => ['Marta', 'Wren'].includes(m.who)), JSON.stringify(tail.map(t => t.who)));
    check('alone, the narrator takes the scene instead', tail.some(m => m.who === 'Game Master'), JSON.stringify(tail.map(t => t.who)));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
