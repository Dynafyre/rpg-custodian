// Romance redesign regression (docs/game-design/romance-redesign.md):
//  - arousal decay per period + post-coital stamina valve (engine rules)
//  - reaction judge: in-band reply → 0; band-breaking reply → tier up;
//    pacing cap ≤ +2/period (ordinary +1)
//  - analyzer no longer emits adjust_affection on charm branches
//  - charm interpretation note text sanity
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const rel = n => page.evaluate(x => { const r = window.rpgCustodianDebug.rel(x); return { aff: r.affection || 0, aro: r.arousal || 1, sta: r.npcStamina, ko: !!r.npcUnconscious }; }, n);
const pushReply = (name, mes) => page.evaluate(([n, m]) => {
    const c = SillyTavern.getContext();
    const msg = { name: n, is_user: false, is_system: false, send_date: 'now', mes: m };
    c.chat.push(msg); c.addOneMessage(msg);
    return c.chat.length;
}, [name, mes]);
const judge = (n, preLen) => page.evaluate(([x, l]) => window.rpgCustodianDebug.judgeReaction(x, l), [n, preLen]);

try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
    await wait(6000);
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town'));
    await wait(20000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('shop')); await wait(1200);

    // ---- 1) Engine rules: decay + valve ----
    await page.evaluate(() => window.rpgCustodianDebug.setArousal('Wren', 6));
    await page.evaluate(() => window.rpgCustodianDebug.tick(1)); await wait(300);
    let r = await rel('Wren');
    check('arousal decays 1 per period (6→5)', r.aro === 5, `aro=${r.aro}`);
    await page.evaluate(() => window.rpgCustodianDebug.setArousal('Wren', 9));
    await page.evaluate(() => { const max = window.rpgCustodianDebug.npcStamina('Wren').max; window.rpgCustodianDebug.spendNpcStamina('Wren', max - 1); });
    r = await rel('Wren');
    check('stamina 1 caps arousal at 5 (running out of steam)', r.sta === 1 && r.aro === 5, `sta=${r.sta} aro=${r.aro}`);
    await page.evaluate(() => window.rpgCustodianDebug.spendNpcStamina('Wren', 1));
    r = await rel('Wren');
    check('stamina 0 sets arousal to 2 (satisfied) + KO', r.sta === 0 && r.aro === 2 && r.ko, `sta=${r.sta} aro=${r.aro} ko=${r.ko}`);
    await page.evaluate(() => window.rpgCustodianDebug.tick(3)); await wait(500);   // let her wake (KO recovery = 2 periods)

    // ---- 2) Charm interpretation note text ----
    const noteFail = await page.evaluate(() => window.rpgCustodianDebug.charmNote('failure'));
    const noteCrit = await page.evaluate(() => window.rpgCustodianDebug.charmNote('critical'));
    check('failure note = seen-through, feelings her own', /NOT persuaded/i.test(noteFail) && /her own/i.test(noteFail));
    check('critical note = moved/believes', /believes him completely/i.test(noteCrit));

    // ---- 3) Reaction judge: in-band reply at Wary → no movement ----
    await page.evaluate(() => window.rpgCustodianDebug.setAffection('Wren', 0));
    await page.evaluate(() => window.rpgCustodianDebug.setArousal('Wren', 1));
    let pre = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await pushReply('Wren', 'Wren gives you a curt nod from behind her work, not unkind but not lingering either. "Nails are two coppers the bundle. Anything else, or are you just letting the cold in?"');
    await judge('Wren', pre); await wait(500);
    r = await rel('Wren');
    check('in-band curt reply at Wary → affection stays 0', r.aff === 0, `aff=${r.aff}`);

    // ---- 4) Reaction judge: far-outside-band warmth at Wary → tier up (≤ cap) ----
    pre = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await pushReply('Wren', 'Wren sets down her pen and looks at you — really looks, in a way she never has. "Stay a while," she says quietly, reaching across the counter to rest her hand over yours. "I closed early. I... I kept thinking about what you did for me. Nobody has ever stood up for me like that." She squeezes your fingers, cheeks coloring, and doesn\'t let go.');
    await judge('Wren', pre); await wait(500);
    r = await rel('Wren');
    check('band-breaking warmth at Wary → affection rises', r.aff >= 1 && r.aff <= 2, `aff=${r.aff}`);
    const afterFirst = r.aff;

    // ---- 5) Pacing cap: more warmth same period → gain capped ----
    pre = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await pushReply('Wren', 'She comes around the counter and hugs you tightly, face pressed to your shoulder. "I mean it. Come for supper tonight. I want you to meet my sister — I\'ve told her everything about you."');
    await judge('Wren', pre); await wait(500);
    r = await rel('Wren');
    check('pacing cap holds (≤ +2 total this period)', r.aff <= 2, `aff=${r.aff} (was ${afterFirst})`);

    // ---- 6) NL probe: flirty proposition at Wary — no adjust_affection from analyzer ----
    await page.evaluate(() => window.rpgCustodianDebug.setAffection('Wren', 0));
    const s = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', '"Close up early, Wren — spend the evening with me. I promise I\'m better company than that ledger." I lean in over the counter with my most winning smile.');
    await page.keyboard.press('Enter');
    let sawBusy = false;
    for (let i = 0; i < 50; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sawBusy = true; if (sawBusy && !b) break; }
    await wait(2000);
    const intentLine = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('\nintent:', intentLine.replace(/^.*intent = /, '').slice(0, 260));
    check('analyzer emits NO adjust_affection on the proposition', !/adjust_affection/.test(intentLine));
    const judgeLog = consoleLogs.filter(l => l.includes('reaction judge')).slice(-1)[0] || '';
    console.log('judge log:', judgeLog.slice(-140) || '(none)');
    check('reaction judge ran on her reply', /reaction judge/.test(judgeLog));
    const tail = await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).map(m => `[${m.is_user ? 'you' : (m.is_system ? 'sys' : m.name)}] ${(m.mes || '').replace(/\s+/g, ' ').slice(0, 130)}`), s);
    for (const l of tail) console.log(' ', l);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
