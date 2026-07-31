// "Go back a time step" — for when the narrator runs ahead and you had places
// to be. A time step is not just a counter: it ages pregnancies, expires
// statuses, hatches eggs, wakes the unconscious and moves everyone's schedule.
// So each step snapshots what it is about to change and the rewind restores it.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const clock = () => page.evaluate(() => {
    const d = window.rpgCustodianDebug, st = d.state();
    return { time: st.currentTime, day: st.dayCount, step: st.timeStep, weekday: d.weekday(), depth: d.undoDepth() };
});
const preg = (n = 'Fern') => page.evaluate((n) => {
    const r = window.rpgCustodianDebug.player().relationships[n] || {};
    return { count: r.pregnancies || 0, prog: r.pregnancy_progress || 0 };
}, n);

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    const t0 = await clock();
    console.log('fresh game:', JSON.stringify(t0));
    check('a fresh session has nothing to rewind', t0.depth === 0 && !(await page.evaluate(() => window.rpgCustodianDebug.canRewind())));

    // give Fern a pregnancy so we can watch a time-derived value move and come back
    await page.evaluate(() => window.rpgCustodianDebug.setPreg('Fern', 1, 40, 'live'));
    const p0 = await preg();

    // the narrator runs away with the day
    await page.evaluate(() => window.rpgCustodianDebug.tick(4)); await wait(2500);
    const t1 = await clock(); const p1 = await preg();
    console.log('after a full day:', JSON.stringify(t1), JSON.stringify(p1));
    check('time moved a whole day', t1.day === t0.day + 1 && t1.step === t0.step + 4, `${t0.step}→${t1.step}`);
    check('the pregnancy aged with it', p1.prog > p0.prog, `${p0.prog}%→${p1.prog}%`);
    check('four steps left four rewind points', t1.depth === 4, String(t1.depth));

    // ── one step back ─────────────────────────────────────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.rewind()); await wait(2000);
    const t2 = await clock(); const p2 = await preg();
    console.log('after one rewind:', JSON.stringify(t2), JSON.stringify(p2));
    check('the clock stepped back exactly one period', t2.step === t1.step - 1, `${t1.step}→${t2.step}`);
    check('the day rolled back with it', t2.day === t0.day && t2.time === 3, `day ${t2.day}, period ${t2.time}`);
    check('the pregnancy un-aged too (not just the counter)', p2.prog === p1.prog - 5, `${p1.prog}%→${p2.prog}%`);

    // ── all the way back ──────────────────────────────────────────────────
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.rpgCustodianDebug.rewind()); await wait(1200); }
    const t3 = await clock(); const p3 = await preg();
    console.log('fully rewound:', JSON.stringify(t3), JSON.stringify(p3));
    check('back where the day began', t3.step === t0.step && t3.day === t0.day && t3.time === t0.time, JSON.stringify(t3));
    check('the pregnancy is exactly as it was', p3.prog === p0.prog, `${p0.prog}% vs ${p3.prog}%`);
    check('the weekday came back too', t3.weekday === t0.weekday, `${t0.weekday} vs ${t3.weekday}`);
    check('the stack is empty again', t3.depth === 0, String(t3.depth));

    // ── it refuses politely when there is nothing left ────────────────────
    const before = await page.evaluate(() => (SillyTavern.getContext().chat || []).length);
    await page.evaluate(() => window.rpgCustodianDebug.rewind()); await wait(1200);
    const t4 = await clock();
    const said = await page.evaluate((b) => (SillyTavern.getContext().chat || []).slice(b).map(m => m.mes || '').join(' '), before);
    check('rewinding past the start changes nothing', t4.step === t3.step && t4.day === t3.day, JSON.stringify(t4));
    check('and says so', /Nothing to rewind/i.test(said), said.slice(0, 60));

    // ── a status that expired should come back ────────────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.buff('player', 'charm', 2, 'brief courage'));
    const fxBefore = await page.evaluate(() => (window.rpgCustodianDebug.player().customEffects || []).filter(e => e.active !== false).length);
    await page.evaluate(() => window.rpgCustodianDebug.tick(5)); await wait(2500);
    const fxAfter = await page.evaluate(() => (window.rpgCustodianDebug.player().customEffects || []).filter(e => e.active !== false).length);
    await page.evaluate(async () => { for (let i = 0; i < 5; i++) await window.rpgCustodianDebug.rewind(); }); await wait(3000);
    const fxBack = await page.evaluate(() => (window.rpgCustodianDebug.player().customEffects || []).filter(e => e.active !== false).length);
    console.log(`effects: ${fxBefore} → after 5 steps ${fxAfter} → rewound ${fxBack}`);
    check('an effect that timed out is restored by rewinding', fxBack === fxBefore, `${fxBefore}/${fxAfter}/${fxBack}`);

    // ── the menu offers it, with the destination named ────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.tick(1)); await wait(1500);
    await page.click('#rpg-menu-button'); await wait(600);
    const menu = await page.evaluate(() => [...document.querySelectorAll('#rpg-menu-popup .rpg-menu-item')].map(e => e.textContent.trim()));
    console.log('menu:', JSON.stringify(menu.filter(m => /back|Wait|Date/.test(m))));
    check('the RPG menu offers the rewind', menu.some(m => /Go back a time step/.test(m)), '');
    check('and names where it goes back to', menu.some(m => /back to .*(Morning|Day|Evening|Night)/.test(m)), menu.find(m => /Go back/.test(m)) || '');

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
