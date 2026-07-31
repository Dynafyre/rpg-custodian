// Dyna: the GM kept narrating things it shouldn't — scene-painting over
// ordinary conversation ("Dyna's command cuts through the soft hiss of the gas
// range… the scarred prep island waits between the hanging herbs"). It should
// narrate RESOLVED GAME ACTIONS and otherwise stay out of the way.
//
// Counts Game Master messages per turn for a spread of inputs.
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
    for (let i = 0; i < 55; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2500);
    return page.evaluate((f) => (SillyTavern.getContext().chat || []).slice(f).map(m => ({
        who: m.is_user ? 'you' : (m.is_system ? `sys:${m.name}` : m.name),
        mes: (m.mes || '').replace(/\s+/g, ' '),
    })), from);
};
const gmProse = (tail) => tail.filter(m => m.who === 'Game Master' && !/^[🚶💾🎲⏰⏪🗓️👋]/u.test(m.mes));

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);

    // 1. plain conversation with a present NPC — she answers, GM says nothing
    let tail = await turn(`"Morning, Bryony. Sleep alright?"`);
    for (const m of tail) console.log(`   [${m.who}] ${m.mes.slice(0, 90)}`);
    check('conversation: the NPC answers', tail.some(m => m.who === 'Bryony'));
    check('conversation: the GM does not narrate over it', gmProse(tail).length === 0, gmProse(tail).map(m => m.mes.slice(0, 70)).join(' | '));

    // 2. idle musing addressed to nobody — silence is correct
    tail = await turn(`I lean on the fence post and watch the clouds for a while, thinking about nothing much.`);
    for (const m of tail) console.log(`   [${m.who}] ${m.mes.slice(0, 90)}`);
    check('idle musing draws no GM scene-painting', gmProse(tail).length === 0, gmProse(tail).map(m => m.mes.slice(0, 70)).join(' | '));

    // 3. an order given to an NPC (Dyna's actual case) — hers to answer
    tail = await turn(`"Bryony, fetch me the good rope from the shed."`);
    for (const m of tail) console.log(`   [${m.who}] ${m.mes.slice(0, 90)}`);
    check('a command to an NPC is HER scene, not the narrator\'s', gmProse(tail).length === 0, gmProse(tail).map(m => m.mes.slice(0, 70)).join(' | '));

    // 4. a real resolved action — the GM SHOULD speak
    tail = await turn(`I brace my shoulder against the heavy cart and heave it out of the mud.`);
    for (const m of tail) console.log(`   [${m.who}] ${m.mes.slice(0, 110)}`);
    const rolled = tail.some(m => /🎲/.test(m.mes)) || gmProse(tail).length > 0;
    check('a physical feat still gets narrated', rolled, gmProse(tail).map(m => m.mes.slice(0, 70)).join(' | ') || 'nothing');

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
