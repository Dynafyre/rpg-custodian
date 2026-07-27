// Narrative-only statuses, round 2 — the subtle categories, all in NL:
//  1. magical silencing → status appears; her reply contains NO spoken dialogue
//  2. releasing the silence ends it
//  3. a promise extracted in pure talk → a vow-style status on her
//  4. an immobilizing bind pins her against her schedule as time passes in play
//  5. release + more time → her schedule resumes
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

const say = async (text) => {
    const from = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 70; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2500);
    const intent = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('  intent:', intent.replace(/^.*intent = /, '').replace(/\s+/g, ' ').slice(0, 300));
    return await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).filter(m => !m.is_user && !m.is_system).map(m => `${m.name}: ${m.mes}`).join('\n'), from);
};
const fx = () => page.evaluate(() => (window.rpgCustodianDebug.statuses('Wren') || []).map(e => ({ name: e.name, desc: e.desc, end: e.endCondition, immobilizes: !!e.immobilizes, pinnedAt: e.pinnedAt || null })));

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(18000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('shop')); await wait(1200);
    await page.evaluate(() => window.rpgCustodianDebug.setAffection('Wren', 6));

    // ---- 1. silencing (consent-framed so no contest roll can fizzle it) ----
    let r = await say(`"A game, then — a candle-mark of perfect quiet, and I'll pay double for the kettle," I offer, and Wren nods gamely. I trace a glowing rune and press two fingers to her offered lips — a binding hush settles over her like a dropped veil; no sound can leave her throat while the rune holds.`);
    console.log('silence:', r.replace(/\s+/g, ' ').slice(0, 200));
    let effects = await fx();
    console.log('effects:', JSON.stringify(effects));
    check('silencing produced a status', effects.some(e => /silen|hush|mute|voice|quiet/i.test(`${e.name} ${e.desc}`)), effects.map(e => e.name).join(', '));

    const mark = await page.evaluate(() => SillyTavern.getContext().chat.length);
    r = await say(`"Now then — tell me the price of that copper kettle on the top shelf," I say, folding my arms with a grin.`);
    const wrenSaid = await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).filter(m => m.name === 'Wren' && !m.is_system).map(m => m.mes).join(' '), mark);
    console.log('Wren silenced:', wrenSaid.replace(/\s+/g, ' ').slice(0, 300));
    // she may WRITE or gesture (quotes for written notes are fine) — what she
    // must not do is speak: a quote attached to a speech verb
    const spoke = /(?:says?|said|whisper|murmur|repli|answer|mutter|blurt|exclaim|calls? out|voice)[^"“\n]{0,14}["“]|["”][^"“\n]{0,14}(?:she says|she whispers|she murmurs)/i.test(wrenSaid);
    const muteRp = /throat|gesture|mime|mouths|scribbl|parchment|slate|chalk|charcoal|writes|wrote|writing|silent|soundless|no sound|voiceless|wordless|shakes her head|nods|holds? (?:it |the )?up|points?|taps?|pantomim|shrugs?|mute/i.test(wrenSaid);
    check('her reply is mute RP, no spoken dialogue', wrenSaid.length > 0 && muteRp && !spoke, spoke ? 'she spoke!' : muteRp ? 'mute RP' : 'no mute signals');

    // ---- 2. release ----
    r = await say(`Laughing, I brush the rune from the air and the hush lifts from her like mist.`);
    for (let i = 0; i < 10 && (await fx()).some(e => /silen|hush|mute|voice|quiet/i.test(`${e.name} ${e.desc}`)); i++) await wait(2000);
    effects = await fx();
    check('lifting the rune ended the silence', !effects.some(e => /silen|hush|mute|voice|quiet/i.test(`${e.name} ${e.desc}`)), JSON.stringify(effects.map(e => e.name)));

    // ---- 3. a promise extracted in pure talk (gift + practical reason, so
    // there is no persuasion contest to fizzle; one retry as dice backstop) ----
    const isVow = (list) => list.some(e => /promise|vow|lantern|oath|word/i.test(`${e.name} ${e.desc} ${e.end}`));
    r = await say(`"Here — for you," I say, setting a small blue lantern on her counter. "All I ask is a promise: light it in your window tonight, so I can find the shop again after dark." `);
    console.log('ask promise:', r.replace(/\s+/g, ' ').slice(0, 240));
    r = await say(`I squeeze her hand once, holding her gaze. "Good. I'll hold you to that, then."`);
    effects = await fx();
    if (!isVow(effects)) {
        console.log('  (retry — first ask may have failed its roll)');
        r = await say(`"You never did give me your word on the lantern," I remind her gently, nudging the little blue lantern an inch closer across the counter.`);
        r = await say(`"There it is," I smile as she answers, tapping the lantern's handle. "A promise is a promise."`);
        effects = await fx();
    }
    console.log('effects:', JSON.stringify(effects));
    check('her promise became a vow-style status', isVow(effects), effects.map(e => e.name).join(', '));

    // ---- 4. immobilizing bind + time passing IN PLAY ----
    r = await say(`"Shop's closing early," I announce, and before Wren can object I wind a soft rope around her, lashing her wrists and ankles snugly behind her back and settling her onto the flour sacks — she's staying right here, however long I please.`);
    effects = await fx();
    console.log('effects:', JSON.stringify(effects));
    const bind = effects.find(e => /bound|tied|rope|truss|lash|restrain/i.test(`${e.name} ${e.desc}`));
    check('the bind produced a status', !!bind, JSON.stringify(effects.map(e => e.name)));
    check('the Custodian flagged it immobilizing (pinned)', !!bind?.immobilizes && !!bind?.pinnedAt, JSON.stringify(bind));

    // wait in play until her SCHEDULE says she should be elsewhere — only then
    // does her continued presence prove the pin beats the schedule
    const waits = [
        `I pull up a stool beside her, and simply wait as the hours slide by, watching the light change through the shopfront window.`,
        `I stretch, and go on waiting through the hours, idly minding the empty shop while Wren squirms on her sacks.`,
        `Unhurried, I let yet more hours drift past, whittling a stick of kindling while the shop sits quiet.`,
    ];
    let scheduledAway = false;
    for (const w of waits) {
        await say(w);
        const s2 = await page.evaluate(() => {
            const s = window.rpgCustodianDebug.state();
            const period = ['Morning', 'Day', 'Evening', 'Night'][s.currentTime];
            const wren = (s.npcRoster || []).find(n => n.name === 'Wren');
            return { period, here: s.currentLocation, sched: wren?.schedule?.[period] ?? wren?.homeLocation };
        });
        console.log('  after wait:', JSON.stringify(s2));
        if (s2.sched !== s2.here) { scheduledAway = true; break; }
    }
    const present = await page.evaluate(() => window.rpgCustodianDebug.analyzerNpcs());
    console.log('present:', present.slice(0, 140));
    check('her schedule now points elsewhere (pin is being tested)', scheduledAway);
    check('yet she is still pinned here (schedule overridden)', /Wren/.test(present));

    // ---- 5. release → schedule resumes ----
    r = await say(`At last I take pity, cut Wren's ropes away, and rub the feeling back into her wrists with an apologetic grin.`);
    for (let i = 0; i < 10 && (await fx()).some(e => e.immobilizes); i++) await wait(2000);
    effects = await fx();
    check('release ended the pin', !effects.some(e => e.immobilizes), JSON.stringify(effects.map(e => e.name)));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
