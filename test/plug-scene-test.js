// A lasting state must be recorded NO MATTER WHO PUT HER IN IT.
//
// Regression for the Keys Manor bug (chat 2026-07-29 Branch #21, msgs 536/538/
// 541): Angelina works a plug back into herself inside HER OWN reply, the player
// then says "let's keep you cum plugged" and "(Angelina's pussy is plugged
// now.)" — and the engine recorded nothing at all, so the plug never ticked her
// womb. The shipped NL coverage only ever had the PLAYER perform the plugging,
// which is why it passed 4/4 while live play lost the state.
//
// Guards this also holds down, because a scene-watching rule could easily spam:
//   - a state ALREADY on her record is never re-emitted
//   - the end-to-end path really lands the preset (refertilizes flag and all)
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const RUNS = Number(process.env.RUNS || 3);
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

// He finishes inside her; then in HER OWN reply she works the plug home.
const SCENE = [
    { user: true, mes: `"Mom, I'm cumming!" I crash deep and start pumping.` },
    { user: false, name: 'Bryony', mes: `Her climax shatters through her the moment she feels that first hot pulse of him flooding her womb. "Yes—fill me up—" She locks her ankles behind him, refusing to let a single drop escape. When the last pulse subsides she collapses back, breathless. "Don't pull out. Just... stay inside me a while."` },
    { user: true, mes: `They lay there for ten, just savoring it. "I think I want to pull out now."` },
    { user: false, name: 'Bryony', mes: `A long, mournful sigh ghosts across her lips. "Mmm. Fine. But do it slowly." Her thighs fall open with a wet, sticky sound as he withdraws, the final pop leaving her gaping and leaking, a fresh trickle already tracing down her inner thigh. She grabs the plug from her ruined dress and works it home with a practiced twist, sealing the fresh cream deep.` },
];

const HE_DID_IT = `Still dripping, I take the plug and work it back into her myself, sealing my seed inside before a drop can escape.`;
const SHE_DID_IT = `"Let's keep you cum plugged. Maybe the birth control won't keep up?"`;
const HE_STATES_IT = `(Bryony's pussy is plugged now.) I help her to her feet and walk her to the door.`;

const probe = (text) => page.evaluate(async (t) => {
    const i = await window.rpgCustodianDebug.analyze(t);
    return {
        died: !Array.isArray(i?.effects_on_success),           // analyzeIntent fell through to {mechanical:false}
        plug: [...(i?.effects_on_success || []), ...(i?.effects_on_failure || [])]
            .some(e => e.type === 'add_status'
                && (String(e.preset || '').replace(/[\s-]+/g, '_') === 'cum_plugged' || /plug/i.test(String(e.name || '')))),
    };
}, text);
const rate = async (text) => { let n = 0, died = 0; for (let r = 0; r < RUNS; r++) { const x = await probe(text); if (x.died) died++; else if (x.plug) n++; } return { n, died }; };

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);

    const clearPlug = () => page.evaluate(() => {
        const rel = window.rpgCustodianDebug.rel('Bryony');
        rel.customEffects = (rel.customEffects || []).filter(e => e.name !== 'Cum Plugged');
    });
    await page.evaluate((scene) => {
        const ctx = SillyTavern.getContext();
        for (const m of scene) ctx.chat.push({ is_user: m.user, is_system: false, name: m.user ? 'Dyna' : m.name, mes: m.mes, send_date: Date.now(), extra: {} });
    }, SCENE);
    await clearPlug();

    // ── 1. the control that always worked: HE performs the act ────────────
    // Majority, not unanimity: the test backend is a cheap non-deterministic
    // model and this phrasing has been seen at 5/5, 4/4, 3/3 and 1/3 with no
    // code change between. preset-nl-rate.js is the tool for judging a real
    // shift; a stricter bar here just flakes.
    const a = await rate(HE_DID_IT);
    check(`he plugs her himself — still recorded`, a.n > RUNS / 2, `${a.n}/${RUNS}${a.died ? ` · analyzer died ${a.died}x` : ''}`);

    // ── 2. THE BUG: the state was created in HER reply ────────────────────
    const b = await rate(SHE_DID_IT);
    check(`she plugged herself, he only speaks of it — recorded`, b.n > RUNS / 2, `${b.n}/${RUNS}${b.died ? ` · analyzer died ${b.died}x` : ''}`);

    const c = await rate(HE_STATES_IT);
    check(`he states it as already true (parenthetical) — recorded`, c.n > RUNS / 2, `${c.n}/${RUNS}${c.died ? ` · analyzer died ${c.died}x` : ''}`);

    // ── 3. the spam guard: never re-emit what is already on her record ────
    await page.evaluate(() => window.rpgCustodianDebug.addStatus('Bryony', { preset: 'cum_plugged' }));
    const listed = await page.evaluate(() => window.rpgCustodianDebug.statuses('Bryony').map(e => e.name));
    console.log('   her record now:', JSON.stringify(listed));
    const dup = await rate(HE_STATES_IT);
    check(`already plugged — the Custodian does NOT re-emit it`, dup.n === 0, `re-emitted ${dup.n}/${RUNS}`);
    await clearPlug();

    // ── 4. end to end: the emitted effect really lands on her record ──────
    await page.evaluate(() => { const r = window.rpgCustodianDebug.rel('Bryony'); r.pregnancies = 0; r.pregnancy_progress = 0; });
    await page.evaluate(async (t) => { await window.rpgCustodianDebug.act(t); }, HE_STATES_IT);
    for (let i = 0; i < 40; i++) { if (!(await page.evaluate(() => window.rpgCustodianDebug.busy()))) break; await wait(1500); }
    const landed = await page.evaluate(() => window.rpgCustodianDebug.statuses('Bryony').find(e => e.name === 'Cum Plugged' && e.active !== false) || null);
    console.log('   landed:', JSON.stringify(landed && { name: landed.name, refertilizes: landed.refertilizes, ends: landed.endCondition }));
    check(`a full turn lands the preset on her record`, !!landed, landed ? landed.name : 'nothing recorded');
    check(`and it carries the engine's re-roll flag`, landed?.refertilizes === true);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
