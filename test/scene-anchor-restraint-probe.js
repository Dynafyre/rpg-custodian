// Depth 0 is the most salient slot in the prompt — right against the reply.
// The scene ground truth lives there now, so: do NPCs start obsessing over
// the day of the week in ordinary conversation?
//
// A/B over mundane turns that give no reason to mention a date:
//   arm ON  — anchor live (shipping behavior)
//   arm OFF — anchor suppressed for that one generation (old behavior)
// Counts unprompted weekday mentions in each. ON must not be chattier.
// Finally re-checks that the fact is still available when actually asked.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYISH = /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b|\bday of the week\b|\bwhat day\b/i;

const MUNDANE = [
    `"That's a fine bow. Did you make it yourself?"`,
    `"Any wolves worth worrying about in those woods?"`,
    `"What's the trick to reading tracks, then? I've never had the eye for it."`,
    `"You ever think about leaving this place?"`,
];

const ask = async (text, suppressAnchor) => {
    if (suppressAnchor) await page.evaluate(() => SillyTavern.getContext().setExtensionPrompt('RPG_CUSTODIAN_SCENE', '', 1, 0));
    else await page.evaluate(() => window.rpgCustodianDebug.sceneText());   // ensure it is live
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 45; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2500);
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
    await page.evaluate(() => { window.rpgCustodianDebug.player().relationships['Bryony'].affection = 6; });
    const today = await page.evaluate(() => window.rpgCustodianDebug.weekday());
    console.log(`engine day = ${today}\n`);

    const run = async (label, suppress) => {
        let hits = 0;
        for (const q of MUNDANE) {
            const r = await ask(q, suppress);
            const hit = DAYISH.test(r);
            if (hit) hits++;
            console.log(`[${label}] ${hit ? '⚠️ mentions the day' : 'clean'} — ${r.replace(/\s+/g, ' ').slice(0, 150)}…`);
        }
        console.log(`[${label}] ${hits}/${MUNDANE.length} mundane replies raised the day unprompted\n`);
        return hits;
    };

    const onHits = await run('anchor ON ', false);
    const offHits = await run('anchor OFF', true);

    check('anchor ON does not make NPCs raise the day unprompted', onHits === 0, `${onHits}/${MUNDANE.length} mentions`);
    check('anchor ON is no chattier about the date than anchor OFF', onHits <= offHits, `ON ${onHits} vs OFF ${offHits}`);

    // still available on demand
    const asked = await ask(`"Humor me — what day of the week is it?"`, false);
    const named = WEEKDAYS.filter(d => asked.includes(d));
    check(`still answers correctly when actually asked (${today})`, named.length === 1 && named[0] === today, asked.replace(/\s+/g, ' ').slice(0, 120));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
