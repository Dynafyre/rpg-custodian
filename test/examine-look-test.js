// Look/examine regression:
//  1. Button path (examineNpc): GM description must be untruncated (no
//     mid-sentence cut, no leaked <think> block), multi-sentence, and
//     scene-aware (party member described HERE, not at her shop).
//  2. NL path: looking her over WHILE talking must still emit examine.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const busy = () => page.evaluate(() => window.rpgCustodianDebug.busy());
const chatLen = () => page.evaluate(() => SillyTavern.getContext().chat.length);
const tailFrom = i => page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).map(m => ({ w: m.is_user ? 'you' : (m.is_system ? 'sys' : m.name), mes: (m.mes ?? '') })), i);
async function act(text) {
    while (await busy()) await wait(1000);
    const s = await chatLen();
    console.log(`\n> "${text}"`);
    await page.type('#send_textarea', text); await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 50; i++) { await wait(2000); const b = await busy(); if (b) sb = true; if (sb && !b) break; if (!sb && i > 8 && (await chatLen()) > s) break; }
    await wait(2000);
    for (const m of await tailFrom(s)) console.log(`  [${m.w}] ${m.mes.replace(/\s+/g, ' ').slice(0, 160)}`);
    return s;
}
let failures = 0;
const check = (label, ok) => { console.log(`${ok ? '✅' : '❌'} ${label}`); if (!ok) failures++; };

try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
    await wait(6000);
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('New Game'))?.click());
    await wait(20000);

    // ---- Part 0: story context beats card habits (Dyna's tea-scene repro) ----
    // An evening in the shop's BACK ROOM, tea and flirting, being put up in a
    // cot — examine must describe THAT Wren, not the card's shopkeeper-at-work.
    await page.evaluate(() => window.rpgCustodianDebug.teleport('shop')); await wait(1200);
    await page.evaluate(() => {
        const c = SillyTavern.getContext();
        const push = (name, mes, user = false) => { const m = { name, is_user: user, is_system: false, send_date: 'now', mes }; c.chat.push(m); c.addOneMessage(m); };
        push('Game Master', 'Evening settles over the trading post. Wren bolts the front door, snuffs the counter lamp, and leads you through the curtain into the cramped back room — a kettle, two mismatched chairs, shelves of personal oddments.');
        push('Reigngard', 'I settle into the offered chair, watching her pour the tea. "You always this hospitable to customers after close?"', true);
        push('Wren', 'She snorts, pressing a chipped cup into my hands and folding herself into the other chair, knees drawn up, braid loosened for the night. "Only the ones who overpay without haggling." Hours slip by — stories, teasing, her guard lowering inch by inch.');
        push('Game Master', 'It is deep night now. Wren drags a canvas cot from behind a shelf and wrestles it open beside the stove, smoothing a quilt over it — she is putting you up for the night, here in her back room.');
    });
    await wait(500);
    const before0 = await chatLen();
    await page.evaluate(() => { window.rpgCustodianDebug.examineNpc('Wren'); });
    await wait(20000);
    const out0 = await tailFrom(before0);
    const gm0 = out0.find(m => m.w === 'Game Master' && m.mes.startsWith('👁️'));
    console.log('\nTea-scene examine:', gm0 ? gm0.mes.replace(/\s+/g, ' ').slice(0, 400) : '(none)');
    check('tea-scene: description present', !!gm0);
    if (gm0) {
        check('tea-scene: NOT at the counter/ledger/stool', !/behind the counter|her ledger|the ledger|stool|shelves of goods|open ledger/i.test(gm0.mes));
        check('tea-scene: anchored in the live scene (cot/tea/night/back room)', /cot|tea|quilt|stove|back room|night|lamplight|curtain|chair/i.test(gm0.mes));
    }

    // ---- Part 1: button examine, on a party member days into the road ----
    await page.evaluate(() => window.rpgCustodianDebug.addParty('Wren'));
    await page.evaluate(() => window.rpgCustodianDebug.tick(9)); // ~2+ days of travel together
    await page.evaluate(() => window.rpgCustodianDebug.teleport('forest')); await wait(1500);
    // Real /move emits a 🚶 travel notice; teleport doesn't — seed the spine
    // line + one road beat so the story records leaving the back room.
    await page.evaluate(() => {
        const c = SillyTavern.getContext();
        const push = (name, mes) => { const m = { name, is_user: false, is_system: false, send_date: 'now', mes }; c.chat.push(m); c.addOneMessage(m); };
        push('Game Master', '🚶 **Whispering Woods** — you set out from the trading post at dawn, Wren shouldering a pack at your side, and the days blur into trail-dust and campfires.');
        push('Game Master', 'Two days into the wilds, the canopy closes overhead. Wren walks a half-step behind you, pack straps creaking, scanning the undergrowth.');
    });
    await wait(500);
    const joined = await page.evaluate(() => window.rpgCustodianDebug.rel('Wren').partyJoinedStep);
    check('party tenure tracked (partyJoinedStep set)', joined != null);
    const before = await chatLen();
    await page.evaluate(() => { window.rpgCustodianDebug.examineNpc('Wren'); }); // fire-and-forget: don't await the LLM promise
    await wait(15000);
    const out = await tailFrom(before);
    const gm = out.find(m => m.w === 'Game Master' && m.mes.startsWith('👁️'));
    console.log('\nGM examine output:', gm ? gm.mes.replace(/\s+/g, ' ').slice(0, 400) : '(none)');
    const partyNow = await page.evaluate(() => (window.rpgCustodianDebug.state().party || []));
    console.log('party:', JSON.stringify(partyNow), '| location: forest');
    check('stat readout shown', out.some(m => m.w === 'sys' && m.mes.includes('🔍')));
    check('GM description present', !!gm);
    if (gm) {
        const txt = gm.mes;
        check('no leaked think block', !/<think/i.test(txt));
        check('multi-sentence (>=3 sentence enders)', (txt.match(/[.!?…](\s|$)/g) || []).length >= 3);
        check('not cut mid-sentence', /[.!?…"']\s*$/.test(txt.trim()));
        if (partyNow.includes('Wren')) {
            check('scene-aware (not relocated to her shop)', !/behind the counter|at her shop|in her shop|on her stool|behind her counter/i.test(txt));
            check('moved on from the previous scene (no cot/quilt/stove)', !/cot|quilt|stove/i.test(txt));
        }
    }

    // ---- Part 2: NL look-while-talking triggers examine ----
    const s2 = await act('"So what\'s good in your stock this week, Wren?" I ask, letting my eyes wander slowly over her as she answers, taking in every detail of her.');
    const intents = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('\nintent line:', intents.replace(/^.*intent = /, '').slice(0, 300));
    const examined = /"type":\s*"examine"/.test(intents) ||
        (await tailFrom(s2)).some(m => m.w === 'sys' && m.mes.includes('🔍'));
    check('NL look-while-talking emitted examine', examined);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
