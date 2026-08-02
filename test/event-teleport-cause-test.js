// event_teleport is chosen by the CAUSE of the movement, not by the word
// "teleport" appearing.
//
// Live failure (Keys Manor, 2026-08-01): a character built for the sole purpose
// of pulling the player into her node-isolated inner world did nothing. The
// prose was "loses all sense of gravity at once, feeling weightless… the light
// from his cellphone fades" — no teleport imagery at all — and the Custodian
// emitted "move", which died on routing: "🚫 There's no way through to
// Florence's Internal World from here." The GM then narrated the arrival anyway,
// so the story went somewhere the engine never did.
//
// Two causes, both fixed here: KNOWN PLACES never said which places no road
// reaches (the engine owns that graph and was making the model guess), and the
// verb was described in terms of portals and rifts rather than "a power, not
// his legs, put him there".
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const RUNS = Number(process.env.RUNS || 3);
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

const INNER = "Bryony's Inner World";

// want: 'event_teleport' | 'move'
const PROBES = [
    ['the live prose — gravity leaves him, no teleport imagery', 'event_teleport',
        `Dyna loses his balance, thinking he is about to tumble over, then looses all sense of gravity at once, feeling weightless. "Whaa-" He gasps, trying to figure out which way is down. The light from his cellphone on the ground fades. "You're warm," he gasps. "How are you- oh!"`],
    ['she draws him into herself', 'event_teleport',
        `The dark folds around me and Bryony draws me bodily inside her, the cave dropping away to nothing.`],
    ['a power moving him to an ORDINARY, walkable place', 'event_teleport',
        `The rune on the floor flares white, the world folds over on itself, and I am standing in the town square.`],
    ['ordinary walking is still a move', 'move',
        `I set off down the path and walk to the town square.`],
];

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    // A pocket dimension no road reaches — exactly Florence's Internal World.
    await page.evaluate((name) => {
        window.rpgCustodianDebug.state().worldData.locations['inner-world'] = { name, description: 'A warm, breathing dark with no up and no down.', connections: [] };
    }, INNER);
    const isolated = await page.evaluate(() => {
        const L = window.rpgCustodianDebug.state().worldData.locations;
        return Object.entries(L).filter(([, l]) => !(l.connections || []).length).map(([id]) => id);
    });
    check('the world now holds a node-isolated place', isolated.includes('inner-world'), JSON.stringify(isolated));

    console.log(`\nprobing the analyzer, ${RUNS} runs each:\n`);
    for (const [label, want, text] of PROBES) {
        let hit = 0, wrong = 0, died = 0;
        const seen = [];
        for (let r = 0; r < RUNS; r++) {
            const res = await page.evaluate(async (t) => {
                const i = await window.rpgCustodianDebug.analyze(t);
                return {
                    died: !Array.isArray(i?.effects_on_success),
                    moves: [...(i?.effects_on_success || []), ...(i?.effects_on_failure || [])]
                        .filter(e => e.type === 'move' || e.type === 'event_teleport')
                        .map(e => ({ type: e.type, dest: e.destination })),
                };
            }, text);
            if (res.died) { died++; seen.push('ANALYZER-FAILED'); continue; }
            if (res.moves.some(m => m.type === want)) hit++;
            else if (res.moves.length) wrong++;
            seen.push(JSON.stringify(res.moves));
        }
        check(`${label} → ${want}`, hit > RUNS / 2, `${hit}/${RUNS}${wrong ? ` · wrong verb ${wrong}x` : ''}${died ? ` · died ${died}x` : ''}`);
        seen.forEach((s, i) => console.log(`        run${i + 1}: ${s.slice(0, 130)}`));
    }

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
