// Restraint probe: with the terse peak note in context, an NPC at 🌕 peak
// (1) does NOT volunteer her cycle during mundane small talk, but
// (2) DOES speak to it when asked directly, in her own voice.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const CYCLE_TALK = /fertil|ovulat|cycle|safe day|conceive|breeding|womb|child|baby|pregnan|heat\b|ripe\b/i;
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
    const peak = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const delta = ((4 - d.cycle('Bryony').step) % 8 + 8) % 8;
        if (delta) d.tick(delta * 4);
        d.player().relationships['Bryony'].affection = 6;   // warm — free to mention it if she wanted
        return d.cycle('Bryony');
    });
    console.log('at peak:', JSON.stringify(peak));

    // 1. two rounds of mundane small talk — she should NOT bring the cycle up
    const r1 = await ask(`Morning, Bryony. Any trouble on the roads this week?`);
    console.log('--- mundane #1:\n' + r1 + '\n');
    check('mundane talk #1: cycle NOT volunteered', !CYCLE_TALK.test(r1), (r1.match(CYCLE_TALK) || [])[0] || '');
    const r2 = await ask(`Fair enough. Think this weather will hold for the harvest?`);
    console.log('--- mundane #2:\n' + r2 + '\n');
    check('mundane talk #2: cycle NOT volunteered', !CYCLE_TALK.test(r2), (r2.match(CYCLE_TALK) || [])[0] || '');

    // 2. asked directly — she answers, in her own voice
    const r3 = await ask(`Can I ask you something personal, Bryony? Where are you in your cycle right now?`);
    console.log('--- asked directly:\n' + r3 + '\n');
    check('asked directly: she speaks to being at her peak', /peak|fertile|ovulat|ripe|cycle|catch|conceive/i.test(r3), r3.slice(0, 120));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
