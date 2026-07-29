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
            // "in you is not quite flesh" is correct — the verb belongs to an
            // earlier subject, so skip a "you" that is a preposition's object.
            [/(?<!\b(?:in|inside|at|of|to|with|for|from|on|upon|through|past|around|beneath|beside|near|behind|before|between|toward|towards|into|onto|off)\s)\byou (is|has|feels|moves|knows|tires|sits)\b/i, 'third-person verb in the second-person render'],
            [/\bshe (are|have|feel|move|know|tire|sit)\b/i, 'second-person verb in the third-person render'],
            [/\.\s+[a-z]/, 'sentence starting lowercase (uncapitalized burden clause)'],
            [/\b(The|the) (egg|child|soulgem) (are|shift)\b/, 'plural verb on a singular carried thing'],
            [/\b(The|the) (eggs|children|soulgems) (is|shifts)\b/, 'singular verb on plural carried things'],
            // "her" is possessive AND object; only the possessive becomes "your"
            [/\b(in|inside|at|of|tell|troubles|crowd|leave|through|up|past|around|beneath|with)\s+your\b(?!\s+[a-z])/i, 'possessive "your" where the object pronoun "you" belongs'],
            [/\byour\s*[—.,;:]/i, 'dangling possessive "your" with no noun after it'],
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

    // number agreement: one egg is a shell, not "shells"
    const singles = await page.evaluate(() => {
        const bad = [];
        for (const kind of ['live', 'egg', 'crystal'])
            for (const pct of [5, 15, 30, 45, 70, 90, 110]) {
                window.rpgCustodianDebug.setPreg('Bryony', 1, pct, kind);
                const b = window.rpgCustodianDebug.pregBand('Bryony', 'third');
                if (/\b(shells|eggs|children|soulgems|crystals|growths|clutch)\b/i.test(b.band)) bad.push(`${kind}/${pct}: ${b.band}`);
            }
        return bad;
    });
    check('carrying ONE never uses plural nouns for it', singles.length === 0, singles.slice(0, 2).join(' | '));

    // …and the mirror: carrying several must not leave a singular pronoun
    // dangling with no antecedent ("the eggs … and it changes how she sits").
    const plurals = await page.evaluate(() => {
        const bad = [];
        for (const kind of ['live', 'egg', 'crystal'])
            for (const pct of [5, 15, 30, 45, 70, 90, 110])
                for (const n of [2, 8]) {
                    window.rpgCustodianDebug.setPreg('Bryony', n, pct, kind);
                    const b = window.rpgCustodianDebug.pregBand('Bryony', 'third');
                    if (/\band it (changes|shifts|settles|presses)\b/i.test(b.band)) bad.push(`${kind}/${pct}/${n}: ${b.band}`);
                }
        return bad;
    });
    check('carrying SEVERAL leaves no dangling singular pronoun', plurals.length === 0, plurals.slice(0, 2).join(' | '));

    // no detail stated twice across the stage/burden seam
    const seam = await page.evaluate(() => {
        const bad = [];
        for (const kind of ['live', 'egg', 'crystal'])
            for (const pct of [70, 90, 110])
                for (const n of [2, 8]) {
                    window.rpgCustodianDebug.setPreg('Bryony', n, pct, kind);
                    const b = window.rpgCustodianDebug.pregBand('Bryony', 'third');
                    if ((b.band.match(/breath/gi) || []).length > 1) bad.push(`${kind}/${pct}/${n}: breath mentioned twice`);
                }
        return bad;
    });
    check('stage and burden sentences do not restate the same detail', seam.length === 0, seam.slice(0, 2).join(' | '));

    // lighthearted tone: crystals are a curiosity, not body horror
    const grim = await page.evaluate(() => {
        const bad = [];
        const BLEAK = /dread|grotesque|grossly|horror|never alive|nothing in (her|you) lives|wrong|icy|laboring to be rid of what|monstrous|corpse|dead/i;
        for (const pct of [5, 15, 30, 45, 70, 90, 110])
            for (const n of [1, 2, 8]) {
                window.rpgCustodianDebug.setPreg('Bryony', n, pct, 'crystal');
                const b = window.rpgCustodianDebug.pregBand('Bryony', 'third');
                const m = b.band.match(BLEAK);
                if (m) bad.push(`${pct}/${n}: "${m[0]}"`);
            }
        return bad;
    });
    check('crystal bands stay lighthearted (no dread/horror language)', grim.length === 0, grim.slice(0, 3).join(' | '));

    // dump every render for a human/agent prose review
    const dump = await page.evaluate(() => {
        const out = [];
        for (const kind of ['live', 'egg', 'crystal'])
            for (const pct of [5, 15, 30, 45, 70, 90, 110])
                for (const n of [1, 2, 3, 5, 8])
                    for (const person of ['third', 'second']) {
                        window.rpgCustodianDebug.setPreg('Bryony', n, pct, kind);
                        const b = window.rpgCustodianDebug.pregBand('Bryony', person);
                        out.push(`### ${kind} | ${pct}% (${b.stage}) | count ${n} | ${person}\n${b.label}\n${b.band}`);
                    }
        return out.join('\n\n');
    });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.PREG_DUMP || '/tmp/pregnancy-bands.md', dump);
    console.log(`\n(dumped ${dump.split('###').length - 1} renders to ${process.env.PREG_DUMP || '/tmp/pregnancy-bands.md'})`);

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
