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

    // ---- Part 1: button examine, on a party member away from her shop ----
    await page.evaluate(() => window.rpgCustodianDebug.addParty('Wren'));
    await page.evaluate(() => window.rpgCustodianDebug.teleport('forest')); await wait(1500);
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
