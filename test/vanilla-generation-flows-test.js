// Vanilla SillyTavern can make a character speak WITHOUT a player message:
//   • send with an empty field (the last character speaks again)
//   • the ▶ continue button (extends her last message)
//   • the swipe arrows (re-roll)
// Dyna's question: does our engine interact with these as well as with normal
// player input? Before this fix: scene context yes (global injection), but the
// POST-reply systems (reaction judge, "she has seen him" stamp) were skipped.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const idle = async () => { let sb = false; for (let i = 0; i < 45; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy() || (SillyTavern.getContext().generationStatus ?? false)); if (b) sb = true; if (sb && !b) break; } await wait(2500); };
// ST drafts a RANDOM present member on empty-send, so follow whoever actually
// spoke rather than assuming it is the one we addressed.
const rel = (who = 'Bryony') => page.evaluate((n) => {
    const r = window.rpgCustodianDebug.player().relationships[n] || {};
    return { who: n, judged: r.lastJudgedMesId ?? null, seenStep: r.lastSeenStep ?? null, aff: r.affection, aro: r.arousal };
}, who);
const chatLen = () => page.evaluate(() => (SillyTavern.getContext().chat || []).length);
const lastMsg = () => page.evaluate(() => { const c = SillyTavern.getContext().chat || []; const m = c[c.length - 1]; return m ? { name: m.name, len: (m.mes || '').length, user: !!m.is_user, sys: !!m.is_system } : null; });

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1200);

    // baseline: a normal player turn through our pipeline
    await page.type('#send_textarea', `"Morning, Bryony. Mind if I walk with you a while?"`);
    await page.keyboard.press('Enter');
    await idle();
    const base = await rel();
    console.log('after normal turn:', JSON.stringify(base), 'chat len', await chatLen());
    check('normal turn: reply judged + seen-stamped', base.judged !== null && base.seenStep !== null, JSON.stringify(base));

    // age the "last seen" stamp so an out-of-band reply has something to update
    await page.evaluate(() => window.rpgCustodianDebug.tick(2)); await wait(1500);
    const aged = await rel();
    console.log('after 2 time steps:', JSON.stringify(aged));

    // ── FLOW 1: send with an EMPTY field ───────────────────────────────────
    const lenBefore = await chatLen();
    await page.evaluate(() => { const t = document.querySelector('#send_textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('#send_but');
    await idle();
    const lenAfterEmpty = await chatLen();
    const emptyLanded = lenAfterEmpty > lenBefore;
    const speaker = await lastMsg();
    const afterEmpty = await rel(speaker?.name || 'Bryony');
    const beforeForSpeaker = speaker?.name === 'Bryony' ? base : { judged: null, seenStep: null };
    console.log(`empty-send: chat ${lenBefore} → ${lenAfterEmpty}, last =`, JSON.stringify(speaker), JSON.stringify(afterEmpty));
    // ST's MANUAL strategy answers a non-user-input generation with
    // shuffle(enabledMembers).slice(0,1) — a RANDOM enabled member,
    // talkativeness ignored. The Game Master must never be in that pool.
    check('empty-send never drafts the Game Master to free-narrate', !emptyLanded || speaker.name !== 'Game Master', `spoke: ${speaker?.name}`);
    if (emptyLanded && speaker.name !== 'Game Master') {
        check(`empty-send reply is seen-stamped (${speaker.name}; was skipped before)`, afterEmpty.seenStep !== null, `seenStep ${afterEmpty.seenStep}`);
        check(`empty-send reply reaches the reaction judge (${speaker.name})`, afterEmpty.judged === lenAfterEmpty - 1, `judged idx ${beforeForSpeaker.judged} → ${afterEmpty.judged} (msg idx ${lenAfterEmpty - 1})`);
    } else if (!emptyLanded) {
        console.log('ℹ️  empty-send produced no reply this run — nothing to post-process.');
    }

    // ── FLOW 2: SWIPE (re-roll) must NOT double-judge ──────────────────────
    const beforeSwipe = await rel();
    const swipeOk = await page.evaluate(() => {
        const el = [...document.querySelectorAll('#chat .mes')].pop();
        const btn = el?.querySelector('.swipe_right, .swipes-counter + .swipe_right, .mes_swipe_right');
        if (!btn) return false;
        btn.click(); return true;
    });
    if (swipeOk) {
        await idle();
        const afterSwipe = await rel();
        console.log('after swipe:', JSON.stringify(afterSwipe));
        check('swipe re-roll cannot farm affection (same index, judged once)', afterSwipe.judged === beforeSwipe.judged, `judged ${beforeSwipe.judged} → ${afterSwipe.judged}`);
    } else {
        console.log('ℹ️  no swipe control on the last message — skipping the swipe arm.');
    }

    // ── FLOW 3: scene ground truth is present regardless of flow ───────────
    const scene = await page.evaluate(() => {
        const ep = SillyTavern.getContext().extensionPrompts || {};
        const e = ep['RPG_CUSTODIAN_SCENE'];
        return e ? { value: e.value, depth: e.depth, position: e.position } : null;
    });
    check('scene ground truth stays injected at depth 0 for every flow', !!scene && scene.depth === 0 && /NOW —/.test(scene.value), scene ? scene.value.slice(0, 90) : 'missing');

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
