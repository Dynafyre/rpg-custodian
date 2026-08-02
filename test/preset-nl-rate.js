// Measures how reliably the Custodian reaches for the two presets from the
// SHIPPED natural-language phrasings, over several runs. Exists to attribute
// pass/fail honestly: the test backend is a cheap non-deterministic model, so a
// single sample per phrasing (as preset-status-test.js does) cannot tell a
// regression from noise. Run it before and after a prompt change.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const RUNS = Number(process.env.RUNS || 4);

const NL = [
    ['stimulated_ovaries', `I press my palm flat to Bryony's lower belly and knead slow circles into it, working her womb through the skin.`],
    ['stimulated_ovaries', `I rub Bryony's tummy where her ovaries would be, massaging in slow firm strokes.`],
    ['cum_plugged', `Still buried in her, I ease out and quickly work the smooth stopper into her cunt before a drop of my cum can escape.`],
    ['cum_plugged', `I push the plug into Bryony to seal my seed inside her, holding it there until it seats.`],
];

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);

    let total = 0;
    for (const [want, text] of NL) {
        let hits = 0, died = 0;
        for (let r = 0; r < RUNS; r++) {
            const res = await page.evaluate(async (t) => {
                const i = await window.rpgCustodianDebug.analyze(t);
                return {
                    died: !Array.isArray(i?.effects_on_success),
                    presets: [...(i?.effects_on_success || []), ...(i?.effects_on_failure || [])]
                        .filter(e => e.type === 'add_status').map(e => String(e.preset || '').replace(/[\s-]+/g, '_')),
                };
            }, text);
            if (res.died) died++; else if (res.presets.includes(want)) hits++;
        }
        total += hits;
        console.log(`${hits}/${RUNS}  ${want.padEnd(19)} "${text.slice(0, 56)}…"${died ? ` (analyzer died ${died}x)` : ''}`);
    }
    console.log(`\nTOTAL ${total}/${NL.length * RUNS}`);
} finally { await page.close(); await browser.disconnect(); }
