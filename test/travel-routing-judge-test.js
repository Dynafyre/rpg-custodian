// Regression for Dyna's live-play calibration report:
//  1. Multi-hop travel: "head to the shop" from the outskirts routes through
//     town square (BFS) instead of failing on non-adjacency.
//  2. Failed travel sets a narrator note so GM/NPC can't narrate phantom arrivals.
//  3. Judge calibration: concrete acts against the band's "would NOT yet" list
//     score +1 even in an otherwise-sharp-tongued reply (Wren transcript repro),
//     and physical display/innuendo moves arousal.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const loc = () => page.evaluate(() => window.rpgCustodianDebug.state().currentLocation);
const rel = n => page.evaluate(x => { const r = window.rpgCustodianDebug.rel(x); return { aff: r.affection || 0, aro: r.arousal || 1 }; }, n);
const pushReply = (name, mes) => page.evaluate(([n, m]) => {
    const c = SillyTavern.getContext();
    const msg = { name: n, is_user: false, is_system: false, send_date: 'now', mes: m };
    c.chat.push(msg); c.addOneMessage(msg);
    return c.chat.length;
}, [name, mes]);

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

    // ---- 1) Multi-hop routing (Dyna's exact case: outskirts → General Store) ----
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(800);
    const pre = await page.evaluate(() => SillyTavern.getContext().chat.length);
    const ok = await page.evaluate(() => window.rpgCustodianDebug.nlMove('General Store'));
    await wait(1500);
    const hops = await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).filter(m => /^\s*🚶/.test(m.mes || '')).map(m => (m.mes || '').slice(0, 60)), pre);
    console.log('hops:', JSON.stringify(hops));
    check('outskirts → shop routes through town square', ok === true && (await loc()) === 'shop', `loc=${await loc()}`);
    check('each leg recorded in the story spine', hops.length === 2);

    // ---- 2) Unknown destination → note set, no phantom travel ----
    const before = await loc();
    const ok2 = await page.evaluate(() => window.rpgCustodianDebug.nlMove('Crystal Palace'));
    const note = await page.evaluate(() => window.rpgCustodianDebug.travelIssue());
    check('unknown place fails without moving', ok2 === false && (await loc()) === before);
    check('narrator note set (STILL AT, do not narrate arrival)', /STILL AT/.test(note || ''), (note || '').slice(0, 80));

    // ---- 3) Judge calibration: Wren transcript repro at Wary ----
    await page.evaluate(() => window.rpgCustodianDebug.setAffection('Wren', 0));
    await page.evaluate(() => window.rpgCustodianDebug.setArousal('Wren', 1));
    // 3a. Physical display + innuendo (her "coming, or..." reply) → arousal up
    let p = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await pushReply('Wren', 'Wren snorts, shifting her weight so one hip cocks out. Her gaze drifts down the front of his tunic, lingering just a heartbeat too long before snapping back up. She turns toward the shop, looking back over her shoulder, the motion making her dress gape just slightly at the neckline. "Coming, or are you going to stand there with your cock in your hand?"');
    await page.evaluate(l => window.rpgCustodianDebug.judgeReaction('Wren', l), p); await wait(500);
    let r = await rel('Wren');
    check('display + innuendo at Calm → arousal rises', r.aro >= 2, `aro=${r.aro}`);

    // 3b. Concrete acts against Wary's NOT-yet list (invite along, confide
    // homeland, press tin into his palm stepping close) → affection +1
    p = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await pushReply('Wren', 'The bell above the shop door jingles as Wren pushes through. "Sartar," she echoes, the word softer than her usual sharpness. "Most folk here don\'t know the difference between Sartar and a hole in the ground." She turns, tea tin in hand, and steps closer than strictly necessary to press the tin into his palm. "You\'re not a total foreigner," she admits. "Just mostly one. But you\'ve got decent taste in tea and you don\'t haggle like an ass. That counts for something."');
    await page.evaluate(l => window.rpgCustodianDebug.judgeReaction('Wren', l), p); await wait(500);
    r = await rel('Wren');
    check('confide + deliberate closeness + kindness at Wary → affection rises', r.aff >= 1, `aff=${r.aff}`);

    // 3b2. Condition scoping: a distant NPC's status must NOT be judgeable —
    // 'Trizel' isn't in prototype-town's cast (persona-global relationships),
    // so a blatant on-screen "cure" must not end her condition.
    await page.evaluate(() => window.rpgCustodianDebug.addStatus('Trizel', { name: 'Distant Fever', kind: 'disease', desc: 'test', end_condition: 'when her fever breaks and she is cured', duration: 20 }));
    p = await pushReply('Wren', 'The fever breaks at last — she sits up, cured, healthy and beaming, the sickness fully gone from her body.');
    await page.evaluate(() => window.rpgCustodianDebug.checkConditions()); await wait(500);   // clears justCreated
    await page.evaluate(() => window.rpgCustodianDebug.checkConditions()); await wait(3500);  // real judge pass
    const distantFx = await page.evaluate(() => (window.rpgCustodianDebug.rel('Trizel').customEffects || []).map(e => e.name));
    check('distant NPC status survives an off-scene "cure"', distantFx.includes('Distant Fever'), distantFx.join(','));
    await page.evaluate(() => { const r = window.rpgCustodianDebug.rel('Trizel'); r.customEffects = []; });   // cleanup

    // 3c. Regression: in-band curt reply still scores 0
    await page.evaluate(() => window.rpgCustodianDebug.setAffection('Bryony', 0));
    p = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await pushReply('Bryony', 'Bryony doesn\'t lower her bow right away. "State your business," she says flatly. "Bounty board\'s by the gate if you\'re looking for work. Wolves in the north woods, two silver a pelt. Don\'t waste my time and we won\'t have a problem."');
    await page.evaluate(l => window.rpgCustodianDebug.judgeReaction('Bryony', l), p); await wait(500);
    const rb = await rel('Bryony');
    check('in-band curt professional reply still scores 0', rb.aff === 0, `aff=${rb.aff}`);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
