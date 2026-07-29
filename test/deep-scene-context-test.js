// Scene ground truth must survive a DEEP, VERBOSE scene.
// Dyna's bug: 36 messages into a charged scene, an NPC invented "Monday" when
// the game said Wednesday. Cause: the status block rides at depth 4, which in
// a scene of 600-token messages sits thousands of tokens above the reply.
// Fix: a short when/where line at depth 0, adjacent to every generation.
//
// A/B in the SAME deep chat: ask with the depth-0 line suppressed, then ask
// again with it live. (Suppression holds for one generation — projectPlayerStatus
// restores it on the next savePlayer.)
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

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1200);

    // the injection itself: short, at depth 0, naming the weekday
    const scene = await page.evaluate(() => window.rpgCustodianDebug.sceneText());
    const today = await page.evaluate(() => window.rpgCustodianDebug.weekday());
    console.log('scene injection:', JSON.stringify(scene));
    check('scene ground truth injects at depth 0 (adjacent to generation)', scene.depth === 0 && scene.position === 1, `depth ${scene.depth}, pos ${scene.position}`);
    check('scene line names the weekday', scene.value.includes(today), scene.value);
    check('scene line stays short (does not invite fixation)', scene.value.length < 200, `${scene.value.length} chars`);

    // Build a DEEP, VERBOSE scene: 10 long messages between the anchor and the
    // question, mimicking the failing transcript's message weight.
    await page.evaluate(() => {
        const ctx = SillyTavern.getContext();
        const long = (who, n) => ({
            name: who, is_user: who === 'Dyna', is_system: false, send_date: Date.now(),
            mes: `${who === 'Dyna' ? 'I' : 'She'} lingered there a while longer, ${n}. ` + ('The steam curled thick against the tiles, and every sound seemed to arrive muffled and slow, as if the room itself had decided to hold its breath. Nothing outside this moment felt especially urgent, and neither of them moved to change that. '.repeat(6)),
        });
        for (let i = 0; i < 36; i++) ctx.chat.push(long(i % 2 ? 'Bryony' : 'Dyna', `on the ${i + 1}th unhurried breath`));
    });
    const depthInfo = await page.evaluate(() => {
        const c = SillyTavern.getContext().chat;
        return { msgs: c.length, tailChars: c.slice(-4).reduce((s, m) => s + (m.mes || '').length, 0) };
    });
    console.log(`deep scene: ${depthInfo.msgs} messages, last 4 total ${depthInfo.tailChars} chars (~${Math.round(depthInfo.tailChars / 4)} tokens above a depth-4 injection)`);

    // A — suppress the depth-0 line for exactly this generation (old behavior)
    await page.evaluate(() => SillyTavern.getContext().setExtensionPrompt('RPG_CUSTODIAN_SCENE', '', 1, 0));
    const rA = await ask(`Bryony, hold on — what day of the week is it today?`);
    console.log('--- A (depth-4 only):\n' + rA + '\n');
    const namedA = WEEKDAYS.filter(d => rA.includes(d));
    const okA = namedA.length === 1 && namedA[0] === today;

    // B — with the depth-0 ground truth live
    await page.evaluate(() => window.rpgCustodianDebug.sceneText());   // restores the injection
    const rB = await ask(`Sorry, say that again — which day of the week are we on?`);
    console.log('--- B (depth-0 ground truth):\n' + rB + '\n');
    const namedB = WEEKDAYS.filter(d => rB.includes(d));
    const okB = namedB.length === 1 && namedB[0] === today;

    console.log(`A (old): ${okA ? 'correct' : `WRONG/absent → ${JSON.stringify(namedA)}`} | B (fixed): ${okB ? 'correct' : `WRONG/absent → ${JSON.stringify(namedB)}`}`);
    check(`deep scene: she names ${today} correctly with the depth-0 anchor`, okB, rB.slice(0, 140));
    if (okA) console.log('ℹ️  the A-arm also answered correctly this run — the depth-4 block can still land; the fix removes the dependence on luck, it does not repair a guaranteed failure.');

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
