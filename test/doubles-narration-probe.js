// Doubles must show up IN THE PROSE as something outside him:
//   6-6 → an unexpected externality AIDED him (and on a plain success, a small miracle)
//   1-1 → an unexpected externality HARMED him
// Forces each case and reads what the Game Master actually writes.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

// Narrate a forced check result and return the GM's prose.
const narrate = async (dc, force, tierWanted) => page.evaluate(async (dc, force, tierWanted) => {
    const d = window.rpgCustodianDebug;
    let c = null;
    for (let i = 0; i < 40000; i++) {
        const r = d.rollCheck('ruggedness', dc);
        const isBox = r.d1 === 6 && r.d2 === 6, isSnake = r.d1 === 1 && r.d2 === 1;
        if (force === 'box' && !isBox) continue;
        if (force === 'snake' && !isSnake) continue;
        if (tierWanted && r.tier !== tierWanted) continue;
        c = r; break;
    }
    if (!c) return { none: true };
    const intent = { mechanical: true, narration_hint: 'heaving a heavy cart out of the mud', effects_on_success: [], effects_on_failure: [] };
    const prose = await d.narrate(intent, c);
    return { tier: c.tier, total: c.total, dc: c.difficulty, prose };
}, dc, force, tierWanted);

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    // 1. boxcars on a PLAIN success (DC 15: 12+3+3 = 18, exactly success not crit)
    const box = await narrate(18, 'box', 'success');
    console.log(`\n[double sixes → plain success, DC ${box.dc}, total ${box.total}]\n${box.prose}\n`);
    check('boxcars success: prose credits an outside stroke of luck',
        /luck|fortune|chance|happen|sudden|just as|at that moment|gust|slip|shift|give way|catch|miracle/i.test(box.prose || ''), '');

    // 2. boxcars on a critical
    const boxCrit = await narrate(10, 'box', 'critical');
    console.log(`[double sixes → critical, DC ${boxCrit.dc}, total ${boxCrit.total}]\n${boxCrit.prose}\n`);
    check('boxcars critical: still narrates an aiding externality',
        /luck|fortune|chance|sudden|just as|at that moment|gust|slip|shift|give way|catch/i.test(boxCrit.prose || ''), '');

    // 3. snake eyes
    const snake = await narrate(12, 'snake', null);
    console.log(`[snake eyes → ${snake.tier}, DC ${snake.dc}, total ${snake.total}]\n${snake.prose}\n`);
    check('snake eyes: prose names something that went wrong from outside',
        /slip|stumble|wet|shout|snap|give way|betray|lurch|jolt|interrupt|crack|mud|sudden|just then|misfortune|unlucky/i.test(snake.prose || ''), '');

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
