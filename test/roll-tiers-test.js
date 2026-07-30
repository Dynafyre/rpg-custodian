// Roll tiers after Dyna's rebalance:
//  - mixed is a 2-wide near miss (was 3) and is a FAILURE ("no, but…")
//  - a fumble tier exists below plain failure
//  - double sixes swing +3, snake eyes −3, so doubles reach the critical bands
//  - the odds shown to the player match the dice exactly
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    // Empirical tier boundaries: roll a lot at a fixed DC and record which
    // totals produced which tier.
    const bounds = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const DC = 12, seen = {};
        for (let i = 0; i < 4000; i++) {
            const c = d.rollCheck('charm', DC);
            (seen[c.tier] = seen[c.tier] || { min: 99, max: -99 });
            seen[c.tier].min = Math.min(seen[c.tier].min, c.total);
            seen[c.tier].max = Math.max(seen[c.tier].max, c.total);
        }
        return { DC, seen };
    });
    const S = bounds.seen, DC = bounds.DC;
    console.log('observed totals per tier at DC 12:', JSON.stringify(S));
    // Verify the RULES, not the observed extremes: the doubles swing makes some
    // totals unreachable (dice 12 always becomes 15, so a plain 15 never occurs),
    // which would make extreme-matching assertions lie.
    const within = (t, lo, hi) => S[t] && S[t].min >= lo && S[t].max <= hi;
    check('critical only ever at DC+4 or better', within('critical', DC + 4, 99), JSON.stringify(S.critical));
    check('success only ever in DC .. DC+3', within('success', DC, DC + 3), JSON.stringify(S.success));
    check('mixed confined to a 2-wide near miss (DC-2 .. DC-1)', within('mixed', DC - 2, DC - 1), JSON.stringify(S.mixed));
    check('failure runs DC-6 .. DC-3', within('failure', DC - 6, DC - 3), JSON.stringify(S.failure));
    check('fumble exists, only below DC-6', !!S.fumble && within('fumble', -99, DC - 7), JSON.stringify(S.fumble));
    check('every tier actually occurs', ['critical', 'success', 'mixed', 'failure', 'fumble'].every(t => S[t]), Object.keys(S).join(','));

    // mixed must NOT count as success anywhere in the engine
    const mixedIsFailure = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        for (let i = 0; i < 4000; i++) { const c = d.rollCheck('charm', 12); if (c.tier === 'mixed') return { success: c.success, xp: d.awardXp(c) }; }
        return null;
    });
    check('a mixed result is a FAILURE (no success, no XP)', mixedIsFailure && mixedIsFailure.success === false && mixedIsFailure.xp === 0, JSON.stringify(mixedIsFailure));

    // doubles swing
    const doubles = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        let box = null, snake = null;
        for (let i = 0; i < 20000 && (!box || !snake); i++) {
            const c = d.rollCheck('charm', 12);
            if (c.d1 === 6 && c.d2 === 6 && !box) box = c;
            if (c.d1 === 1 && c.d2 === 1 && !snake) snake = c;
        }
        return { box: box && { swing: box.swing, total: box.total, eff: box.eff, tier: box.tier }, snake: snake && { swing: snake.swing, total: snake.total, eff: snake.eff, tier: snake.tier } };
    });
    console.log('doubles:', JSON.stringify(doubles));
    check('double sixes swing +3', doubles.box?.swing === 3 && doubles.box.total === 12 + doubles.box.eff + 3, JSON.stringify(doubles.box));
    check('double sixes reach the critical band', doubles.box?.tier === 'critical', doubles.box?.tier);
    check('snake eyes swing −3', doubles.snake?.swing === -3 && doubles.snake.total === 2 + doubles.snake.eff - 3, JSON.stringify(doubles.snake));
    check('snake eyes land in the fumble band', doubles.snake?.tier === 'fumble', doubles.snake?.tier);

    // the displayed odds must match the dice
    const oddsCheck = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const out = [];
        for (const dc of [8, 10, 12, 14, 16, 18]) {
            let wins = 0; const N = 20000;
            for (let i = 0; i < N; i++) if (d.rollCheck('charm', dc).success) wins++;
            out.push({ dc, empirical: Math.round(wins / N * 100), stated: d.odds(d.effectiveStat('charm'), dc) });
        }
        return out;
    });
    for (const o of oddsCheck) {
        console.log(`   DC ${o.dc}: shown ${o.stated}% · rolled ${o.empirical}%`);
        check(`DC ${o.dc}: displayed odds match the dice`, Math.abs(o.stated - o.empirical) <= 2, `${o.stated} vs ${o.empirical}`);
    }

    // the readout and the GM briefing
    const line = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        for (let i = 0; i < 20000; i++) { const c = d.rollCheck('charm', 12); if (c.d1 === 6 && c.d2 === 6) return d.checkLine(c, 'probe'); }
        return null;
    });
    console.log('readout:', line);
    check('readout announces double sixes', /DOUBLE SIXES/.test(line || ''), String(line).slice(0, 100));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
