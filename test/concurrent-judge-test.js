// The reaction judge and the condition judge now run OFF the critical path:
// each woman's verdict is requested the moment she finishes speaking, and the
// conditions call starts as soon as the story is complete, so both overlap the
// replies that follow instead of queueing behind them.
//
// What must hold regardless of how the timing falls out:
//   1. Every NPC reply is on the page BEFORE any verdict line — no "💗 +1"
//      landing against whichever reply happened to be showing.
//   2. Verdict lines appear in SPEAKER order, then condition outcomes.
//   3. No reply is truncated. A capped judge call overlapping her generation
//      would apply its 220-token ceiling to HER (TempResponseLength is a
//      static singleton in SillyTavern), which reads as a lazy model, not a bug.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const turn = async (text) => {
    const from = await page.evaluate(() => (SillyTavern.getContext().chat || []).length);
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 120; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2500);
    return page.evaluate((f) => (SillyTavern.getContext().chat || []).slice(f).map(m => ({
        who: m.is_user ? 'you' : m.name, sys: !!m.is_system, mes: (m.mes || '').replace(/\s+/g, ' '),
    })), from);
};

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    const present = await page.evaluate(() => {
        const d = window.rpgCustodianDebug, st = d.state(), here = st.currentLocation;
        const sched = { Morning: here, Day: here, Evening: here, Night: here };
        const names = [];
        for (const n of st.npcRoster) if (['Marta', 'Wren', 'Seline'].includes(n.name)) { n.schedule = sched; n.homeLocation = here; names.push(n.name); }
        return names;
    });
    await page.evaluate(() => window.rpgCustodianDebug.teleport(window.rpgCustodianDebug.state().currentLocation)); await wait(1500);

    // load the condition judge up, the way a real save looks mid-campaign
    await page.evaluate((names) => {
        const d = window.rpgCustodianDebug;
        d.addObjective({ name: 'Find the lost ledger', endCondition: 'the player recovers or reads the missing ledger' });
        d.addStatus('player', { name: 'Oath of the Open Road', kind: 'pact', category: 'status', endCondition: 'the player sleeps two nights beneath the same roof', mods: [{ stat: 'craftiness', amount: 1 }] });
        for (const n of names) {
            d.addStatus(n, { name: `Errand for ${n}`, category: 'quest', endCondition: `the player brings ${n} what she asked for` });
            d.addStatus(n, { name: `Pact with ${n}`, kind: 'pact', category: 'status', endCondition: `${n} is openly thanked in front of another woman`, mods: [{ stat: 'charm', amount: 1 }] });
        }
        d.save();
    }, present);

    await page.evaluate(() => window.rpgCustodianDebug.perfClear());
    // watch the response ceiling on every outgoing chat-completion request
    await page.evaluate(() => {
        const c = SillyTavern.getContext();
        window.__mt = [];
        window.__baseline = c.chatCompletionSettings?.openai_max_tokens ?? null;
        c.eventSource.on(c.eventTypes.CHAT_COMPLETION_SETTINGS_READY, (s) => {
            window.__mt.push({ max: s?.max_tokens ?? s?.max_completion_tokens ?? null, msgs: (s?.messages || []).length });
        });
    });
    await turn(`"Marta, Wren, Seline — has anyone seen the old ledger?"`);   // clears the justCreated guard
    const tail = await turn(`I set the ledger on the table. "Found it. Marta, Wren, Seline — thank you, all three of you."`);

    console.log('\nturn transcript:');
    for (const m of tail) console.log(`   [${m.sys ? 'sys' : m.who}] ${m.mes.slice(0, 90)}`);

    // Two DIFFERENT kinds of system line, and they must not be conflated: a
    // reaction line is attributed to the woman who spoke ("Wren: 💗 …"), while
    // a condition line merely happens to name her ("✅ Pact with Wren ends").
    const isReaction = (m) => m.sys && /^[^:]{1,30}: .*(💗|🔥)/.test(m.mes);
    const isCondition = (m) => m.sys && /🏆|✅ \*\*|⚖️/.test(m.mes);
    const isVerdict = (m) => isReaction(m) || isCondition(m);
    const isReply = (m) => !m.sys && !m.who.includes('Game Master') && m.who !== 'you' && present.includes(m.who);

    // ── 1. every reply precedes every verdict line ────────────────────────
    const lastReply = tail.map(isReply).lastIndexOf(true);
    const firstVerdict = tail.findIndex(isVerdict);
    check('every NPC reply lands before any verdict line',
        firstVerdict === -1 || lastReply === -1 || firstVerdict > lastReply,
        `last reply @${lastReply}, first verdict @${firstVerdict}`);

    // ── 2. reaction lines follow speaker order, and precede condition lines ─
    const spoke = tail.filter(isReply).map(m => m.who);
    const reactedFor = tail.filter(isReaction).map(m => m.mes.split(':')[0].trim());
    const expected = spoke.filter(n => reactedFor.includes(n));
    check('reaction lines are in speaker order', JSON.stringify(reactedFor) === JSON.stringify(expected),
        `reactions ${JSON.stringify(reactedFor)} vs spoke ${JSON.stringify(spoke)}`);
    const lastReaction = tail.map(isReaction).lastIndexOf(true);
    const firstCondition = tail.findIndex(isCondition);
    check('condition outcomes come after reaction lines',
        lastReaction === -1 || firstCondition === -1 || firstCondition > lastReaction,
        `last reaction @${lastReaction}, first condition @${firstCondition}`);

    // ── 3. no reply was capped by a concurrent judge ─────────────────────
    // Asserted at the REQUEST, not by reading the prose: judging prose for a
    // mid-sentence ending catches the model stopping oddly, which happens for
    // its own reasons. The real invariant is that a reply is never BUILT with a
    // judge's ceiling. Replies carry the whole chat (many messages); judges and
    // the analyzer send system+user only, so message count tells them apart.
    const mt = await page.evaluate(() => ({ baseline: window.__baseline, calls: window.__mt || [] }));
    const replyReqs = mt.calls.filter(c => c.msgs > 4);
    console.log(`\nmax_tokens per request (user setting ${mt.baseline}):`);
    for (const c of mt.calls) console.log(`   ${c.msgs > 4 ? 'reply ' : 'engine'} max_tokens=${c.max} msgs=${c.msgs}`);
    check('every NPC reply was built with the full response ceiling',
        replyReqs.length > 0 && replyReqs.every(c => c.max === mt.baseline),
        `${replyReqs.length} replies, ceilings ${JSON.stringify([...new Set(replyReqs.map(c => c.max))])}`);

    // Empty replies are reported, not asserted: an A/B against the sequential
    // path (setConcurrentJudges(false)) produced them there too, so this is a
    // pre-existing defect rather than a consequence of judging concurrently.
    const replies = tail.filter(isReply);
    const empty = replies.filter(m => !m.mes.trim());
    if (empty.length) console.log(`   ⚠️  ${empty.length} empty reply (${empty.map(m => m.who).join(', ')}) — pre-existing, occurs on the sequential path too`);

    // ── timing, against the measured pre-change baseline ─────────────────
    const raw = await page.evaluate(() => window.rpgCustodianDebug.perfRaw());
    console.log('\ntiming:');
    for (const t of raw) {
        console.log(`   ${t.action.slice(0, 50)}`);
        console.log(`      total ${t.totalMs}ms · visible ${t.visibleMs}ms · afterLast ${t.afterLastMs}ms`);
        console.log(`      ${t.stages.map(s => `${s.label}=${s.ms}ms`).join('  ')}`);
    }
    const last = raw[raw.length - 1];
    check('the tail after the last visible line is under 20s', last.afterLastMs < 20000, `${last.afterLastMs}ms`);
    check('the conditions judge actually ran', last.stages.some(s => s.label === 'conditions' && s.ms > 100),
        JSON.stringify(last.stages.filter(s => s.label === 'conditions')));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
