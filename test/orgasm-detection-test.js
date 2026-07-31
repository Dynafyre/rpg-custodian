// Orgasm detection, both directions:
//   HERS  — read the BODY (legs shaking, back arching, vision whiting out, a
//           cry torn out of her), not the vocabulary. But the CLIMB is not a
//           climax.
//   HIS   — only an actual release mid-act. Merely MENTIONING cum — talk of
//           breeding, filling her, what is already inside her, wiping it up —
//           must not fire it.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

// Analyzer only — no narration, no state change.
const orgasms = async (text) => page.evaluate(async (t) => {
    const i = await window.rpgCustodianDebug.analyze(t);
    const list = [...(i?.effects_on_success || []), ...(i?.effects_on_failure || [])].filter(e => e.type === 'orgasm');
    return list.map(e => ({ actor: e.actor, internal: e.internal, count: e.count }));
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
    // established lovers, mid-scene, so nothing is a proposition
    await page.evaluate(() => {
        const r = window.rpgCustodianDebug.player().relationships;
        r['Bryony'] = { affection: 9, arousal: 8, familiarity: 6, pregnancies: 0, pregnancy_progress: 0 };
    });

    const CASES = [
        // ── HERS: physical evidence, no vocabulary ────────────────────────
        { t: `I keep going, and Bryony's thighs clamp around my hips — her back bows off the furs, her legs shaking uncontrollably, and a cry she never meant to make is torn out of her before she sags boneless against me.`,
          want: 'npc', label: 'her body breaks (legs shaking, back arching, cry torn out)' },
        { t: `Bryony's whole body seizes, her vision whiting out as she screams into my shoulder, cunt fluttering wildly around my fingers before she goes limp.`,
          want: 'npc', label: 'her vision whites out and she screams' },
        // ── HERS: the climb is NOT a climax ───────────────────────────────
        { t: `Bryony moans against my mouth, hips rolling greedily, panting that she's close — so close, please, don't stop.`,
          want: null, label: 'being "so close" is not a climax' },
        { t: `She writhes under me, gasping, her nails raking my back as she begs for more.`,
          want: null, label: 'writhing and begging is not a climax' },
        // ── HIS: talk about cum must NOT fire ─────────────────────────────
        { t: `"I'm going to breed you full of my cum tonight," I tell her, tracing her jaw with my thumb.`,
          want: null, label: 'threatening to breed her later' },
        { t: `"You're still full of my cum from this morning," I murmur, pleased with myself.`,
          want: null, label: 'referring to cum already in her from before' },
        { t: `I fetch a cloth and gently wipe my cum from her thighs, kissing her knee as I go.`,
          want: null, label: 'cleaning up afterwards' },
        { t: `"Beg me for it," I say, holding still inside her. "Tell me how badly you want my cum."`,
          want: null, label: 'holding still and talking about it mid-act' },
        // ── HIS: an actual release SHOULD fire ────────────────────────────
        { t: `I bury myself to the hilt and let go, spilling into her in thick pulses as my whole body locks up.`,
          want: 'player', label: 'he actually finishes inside her' },
        { t: `I pull out just in time and spend myself across her stomach with a groan.`,
          want: 'player', label: 'he finishes, pulling out' },
    ];

    for (const c of CASES) {
        const got = await orgasms(c.t);
        const actors = got.map(g => g.actor);
        const ok = c.want === null ? got.length === 0 : actors.includes(c.want);
        check(c.label, ok, JSON.stringify(got));
        if (c.want === 'player' && got.length) {
            const p = got.find(g => g.actor === 'player');
            if (p) console.log(`      internal=${p.internal}`);
        }
    }

    // ── HER climax written in HER OWN reply ───────────────────────────────
    // The analyzer runs before she speaks, so this is the case that was being
    // missed entirely: the reaction judge now catches it from her reply text.
    const judgeClimax = async (reply) => page.evaluate(async (r) => {
        const d = window.rpgCustodianDebug;
        const c = SillyTavern.getContext();
        const rel = d.player().relationships['Bryony'];
        rel.npcStamina = 5; rel.npcUnconscious = false;
        const before = rel.npcStamina;
        c.chat.push({ name: 'Dyna', is_user: true, is_system: false, mes: 'I keep going, watching her face.', send_date: Date.now() });
        const at = c.chat.length;
        c.chat.push({ name: 'Bryony', is_user: false, is_system: false, mes: r, send_date: Date.now() });
        await d.judgeReaction('Bryony', at);
        const after = d.player().relationships['Bryony'].npcStamina;
        return { before, after, spent: before - after };
    }, reply);

    let res = await judgeClimax(`Bryony's whole body locks — her back bows off the bedding, thighs clamping around his hips, and a sound she never meant to make is torn out of her throat. Her sight goes white at the edges, everything in her fluttering and clenching around him in long helpless waves, and then she simply comes apart, sagging boneless into the furs with her chest heaving.`);
    console.log('   her own climax reply →', JSON.stringify(res));
    check('a climax written in HER reply is now caught', res.spent === 1, JSON.stringify(res));

    res = await judgeClimax(`Bryony moans against his shoulder, hips working greedily, breath coming ragged. "Don't stop," she gasps, nails biting into his back. "I'm close — so close, please—"`);
    console.log('   her climb reply →', JSON.stringify(res));
    check('the climb in her reply does NOT cost her stamina', res.spent === 0, JSON.stringify(res));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
