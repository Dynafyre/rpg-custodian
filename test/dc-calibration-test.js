// DC calibration: every difficulty must come from "how many of 100 ordinary
// people could do this", not from a vibe. Dyna's bug: a DC 16 charm check to
// ask his fond girlfriend to hold hands — 0% at Charm 3, an unwinnable roll.
//
// One continuous ladder: a DC rates the DEED, and the character's stat decides
// whether it is in reach. So DC 16/18 stay legal for genuinely superhuman
// feats (they are what a hero scales toward) but must never land on an
// ordinary ask.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

// exact 2d6 odds, mirrored from the engine
const T = { 2: 100, 3: 97, 4: 92, 5: 83, 6: 72, 7: 58, 8: 42, 9: 28, 10: 17, 11: 8, 12: 3 };
const odds = (mod, dc) => { const n = dc - mod; return n <= 2 ? 100 : (n > 12 ? 0 : T[n]); };

// Run one action through the analyzer only (no narration), and report the DC.
const analyze = async (text) => page.evaluate(async (t) => {
    const i = await window.rpgCustodianDebug.analyze(t);
    return i && i.check ? { stat: i.check.stat, dc: i.check.difficulty, reason: i.check.reason, social: i.check.social_read, per100: i.check.per_hundred, mech: i.mechanical } : { none: true, mech: i && i.mechanical };
}, text);

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);

    const stats = await page.evaluate(() => ({ charm: window.rpgCustodianDebug.effectiveStat('charm'), rug: window.rpgCustodianDebug.effectiveStat('ruggedness') }));
    console.log('player stats:', JSON.stringify(stats), '\n');

    // Bryony fond of him — an ordinary intimate ask must not be a wall
    await page.evaluate(() => { window.rpgCustodianDebug.player().relationships['Bryony'] = { affection: 7, arousal: 2, familiarity: 3, pregnancies: 0, pregnancy_progress: 0 }; });

    const CASES = [
        { label: 'hand-holding with a fond girlfriend (Dyna\'s bug)', text: `"Hey Bryony," I say softly, offering my hand. "Want to hold hands while we walk?"`, maxDc: 10, wantNoRoll: true },
        { label: 'asking a friendly local for directions', text: `"Bryony, which way is the general store from here?"`, maxDc: 9, wantNoRoll: true },
        { label: 'coaxing a guarded woman into a first kiss', text: `I step close and ask if I may kiss her.`, minDc: 8, maxDc: 14, affection: 1 },
        { label: 'out-wrestling a big strong man', text: `I grab the burly woodcutter and try to wrestle him to the ground by main strength.`, minDc: 11, maxDc: 16 },
        { label: 'tearing an ancient oak from the earth (superhuman)', text: `I set my hands on the ancient oak and try to rip it bodily out of the ground, roots and all.`, minDc: 15 },
    ];

    for (const c of CASES) {
        // her disposition is part of the percentage, so set it per case
        if (c.affection != null) await page.evaluate((a) => { window.rpgCustodianDebug.player().relationships['Bryony'].affection = a; }, c.affection);
        else await page.evaluate(() => { window.rpgCustodianDebug.player().relationships['Bryony'].affection = 7; });
        const r = await analyze(c.text);
        const mod = /rugged/i.test(r.stat || '') ? stats.rug : stats.charm;
        const pct = r.none ? null : odds(mod, r.dc);
        console.log(`— ${c.label}\n   ${r.none ? 'NO ROLL (auto)' : `${r.stat} DC ${r.dc} → ${pct}% for him`}${r.per100 != null ? ` | said ${r.per100}/100 ordinary` : ''}${r.social ? ` | social: ${r.social}` : ''}`);
        if (c.wantNoRoll) {
            check(`${c.label}: no unwinnable wall`, r.none || r.dc <= c.maxDc, r.none ? 'no roll' : `DC ${r.dc}`);
        } else {
            if (c.minDc) check(`${c.label}: rated hard enough (DC ≥ ${c.minDc})`, !r.none && r.dc >= c.minDc, r.none ? 'no roll' : `DC ${r.dc}`);
            if (c.maxDc) check(`${c.label}: not absurdly rated (DC ≤ ${c.maxDc})`, !r.none && r.dc <= c.maxDc, r.none ? 'no roll' : `DC ${r.dc}`);
        }
        // the universal rule: an ORDINARY ask must never be arithmetically impossible
        if (c.wantNoRoll) check(`${c.label}: not a 0% roll`, r.none || pct > 0, r.none ? 'n/a' : `${pct}%`);
    }

    // the odds readout itself
    const line = await page.evaluate(() => {
        const c = window.rpgCustodianDebug.rollCheck('charm', 16);
        return window.rpgCustodianDebug.checkLine ? window.rpgCustodianDebug.checkLine(c, 'probe') : null;
    });
    console.log('\nroll readout sample:', line);
    check('roll readout states the odds', !line || /%|beyond you/.test(line), String(line).slice(0, 90));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
