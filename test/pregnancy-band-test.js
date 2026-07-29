// Pregnancy projected as a BAND, composed from templates:
//   kind (live/egg/crystal) × stage (7) × count bucket (1/2/3/several/many)
// Asserts the composition rules, then DUMPS the corner cases so the prose can
// actually be read (8 crystals at overdue vs 1 egg at mid-term — Dyna's case).
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const band = (count, pct, kind, person) => page.evaluate((c, p, k, pr) => {
    window.rpgCustodianDebug.setPreg('Bryony', c, p, k);
    return window.rpgCustodianDebug.pregBand('Bryony', pr);
}, count, pct, kind, person || 'third');

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1200);

    // ── composition rules ────────────────────────────────────────────────
    const none = await page.evaluate(() => { window.rpgCustodianDebug.setPreg('Bryony', 0, 0, null); return window.rpgCustodianDebug.pregBand('Bryony'); });
    check('no pregnancy → no band', none === null);

    const one70 = await band(1, 70, 'live');
    check('single live mid-term: stage label + count word, no raw %', one70.label === '2nd Trimester · one child' && !/\d+%/.test(one70.band), one70.label);
    check('band is behavioral prose, not a chart reading', /kicks|movement|belly/i.test(one70.band) && one70.band.length > 80, `${one70.band.length} chars`);

    // count buckets
    const b2 = await band(2, 70, 'live'), b3 = await band(3, 70, 'live'), b5 = await band(5, 70, 'live'), b6 = await band(6, 70, 'live'), b8 = await band(8, 70, 'live');
    check('2 → "twins"', b2.countWord === 'twins', b2.countWord);
    check('3 → "triplets"', b3.countWord === 'triplets', b3.countWord);
    check('5 and 6 share one description (not materially different)', b5.band.replace(/five|5/gi, 'N') === b6.band.replace(/six|6/gi, 'N'), '');
    check('8 reads as its own load, not the same as 1', b8.band !== one70.band && /eight/i.test(b8.band), '');

    // multiples clause only once anything can be FELT
    const early2 = await band(4, 15, 'live');
    check('four at implantation: no burden clause (nothing detectable yet)', !/crowd|enormous|monstrous|swollen past/.test(early2.band), early2.band.slice(0, 70));
    const showing4 = await band(4, 70, 'live');
    check('four at 2nd trimester: burden clause present', /crowd/.test(showing4.band), '');

    // kind differentiation at the same stage+count
    const eLive = await band(1, 90, 'live'), eEgg = await band(1, 90, 'egg'), eCry = await band(1, 90, 'crystal');
    check('same stage+count reads differently per womb type', new Set([eLive.band, eEgg.band, eCry.band]).size === 3);
    check('egg band speaks of shells/nesting', /shell|nest/i.test(eEgg.band));
    check('crystal band speaks of cold/stone, no kicks', /cold|crystal|stone/i.test(eCry.band) && !/kick/i.test(eCry.band));
    check('live band speaks of the body bearing a child', /pregnan|belly|kick|breath/i.test(eLive.band));

    // person rendering (her own briefing vs what others perceive)
    const third = await band(2, 85, 'crystal', 'third');
    const second = await band(2, 85, 'crystal', 'second');
    check('third person renders she/her/is', /\bShe\b|\bshe\b/.test(third.band) && !/\bYou\b|\byour\b/.test(third.band), '');
    check('second person renders you/your/are', /\bYou\b|\byou\b|\byour\b/.test(second.band) && !/\bShe\b|\bshe is\b/.test(second.band), '');
    check('no unrendered {tokens} leak in either person', !/[{}]/.test(third.band) && !/[{}]/.test(second.band), '');

    // full sweep: every combination renders cleanly
    const sweep = await page.evaluate(() => {
        const out = [];
        for (const kind of ['live', 'egg', 'crystal'])
            for (const pct of [5, 15, 30, 45, 70, 90, 110])
                for (const n of [1, 2, 3, 5, 8])
                    for (const person of ['third', 'second']) {
                        window.rpgCustodianDebug.setPreg('Bryony', n, pct, kind);
                        const b = window.rpgCustodianDebug.pregBand('Bryony', person);
                        if (!b || /[{}]/.test(b.band) || /undefined|NaN/.test(b.band) || b.band.length < 40) out.push(`${kind}/${pct}/${n}/${person}: ${b && b.band}`);
                    }
        return out;
    });
    check('all 210 kind×stage×count×person combinations render cleanly', sweep.length === 0, sweep.slice(0, 3).join(' | '));

    // Grammar: the count arrives as a whole phrase ("twins", "8 soulgems"), and
    // tokenized verbs only agree with HER. Both are easy to break silently.
    const grammar = await page.evaluate(() => {
        const bad = [];
        const smells = [
            [/\b(twins|triplets|\d+ \w+) of them\b/i, 'double-counted subject ("twins of them")'],
            [/\b(body|belly|skin|weight|cold) are\b/i, 'verb agreeing with the wrong subject ("your body are")'],
            [/\b(twins|triplets|\d+ \w+), all past due, is\b/i, 'singular verb on a plural count'],
            [/\byou (is|has|feels|moves|knows|tires|sits)\b/i, 'third-person verb in the second-person render'],
            [/\bshe (are|have|feel|move|know|tire|sit)\b/i, 'second-person verb in the third-person render'],
            [/\.\s+[a-z]/, 'sentence starting lowercase (uncapitalized burden clause)'],
        ];
        for (const kind of ['live', 'egg', 'crystal'])
            for (const pct of [5, 15, 30, 45, 70, 90, 110])
                for (const n of [1, 2, 3, 5, 8])
                    for (const person of ['third', 'second']) {
                        window.rpgCustodianDebug.setPreg('Bryony', n, pct, kind);
                        const b = window.rpgCustodianDebug.pregBand('Bryony', person);
                        for (const [re, why] of smells) if (re.test(b.band)) bad.push(`${kind}/${pct}/${n}/${person}: ${why}`);
                    }
        return bad;
    });
    check('no grammar smells across the whole combination space', grammar.length === 0, grammar.slice(0, 3).join(' | '));

    // ── read the corner cases ────────────────────────────────────────────
    console.log('\n──────── what the models actually read ────────');
    for (const [n, pct, kind, note] of [[8, 110, 'crystal', "Dyna's case: eight soulgems, overdue"], [1, 70, 'egg', 'one egg, mid-term'], [1, 5, 'live', 'one child, just conceived'], [3, 90, 'egg', 'three eggs, near laying'], [2, 110, 'live', 'twins, overdue']]) {
        const b = await band(n, pct, kind);
        console.log(`\n[${note}]\n  ${b.label}\n  ${b.band}`);
    }
    const own = await band(8, 110, 'crystal', 'second');
    console.log(`\n[her own reunion briefing, same state]\n  ${own.band}`);

    await page.evaluate(() => window.rpgCustodianDebug.setPreg('Bryony', 0, 0, null));
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
