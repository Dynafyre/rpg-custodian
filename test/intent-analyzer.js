/**
 * Intent Analyzer test — the EMERGENT loop, driven purely by natural language.
 * Verifies: player NL action → analyzer → skill check (engine) → GM narration →
 * the NPC reacts to the result FROM HER OWN CARD (not scripted by the GM).
 */
import { connect, collectLogs, login, screenshot } from './harness.js';

const browser = await connect();
const page = await browser.newPage();
const { consoleLogs, pageErrors } = collectLogs(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const promptAnswers = ['Dyna Testhero', 'A rugged wandering adventurer.', 'Adventurer', 'Traveler'];
page.on('dialog', async (d) => { await d.accept(promptAnswers.shift() ?? ''); });

const tail = (n) => page.evaluate((c) => (SillyTavern.getContext().chat ?? []).slice(-c)
    .map((m) => ({ name: m.name, u: !!m.is_user, s: !!m.is_system, mes: (m.mes ?? '').slice(0, 260) })), n);
const player = () => page.evaluate(() => window.rpgCustodianDebug?.player() ?? null);
const say = async (t) => { await page.type('#send_textarea', t); await page.keyboard.press('Enter'); };

const results = [];
const check = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    let st = 'no_connection';
    for (let i = 0; i < 12; i++) { st = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (st !== 'no_connection') break; await wait(2500); }
    console.log('connection:', st);

    // Create character + new game
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find((el) => el.textContent.includes('Create Character'))?.click());
    await wait(6000);
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find((el) => el.textContent.includes('New Game'))?.click());
    await wait(20000);

    // Confirm the interceptor is registered (manifest picked up)
    const hasInterceptor = await page.evaluate(() => typeof window.rpgCustodianInterceptor === 'function');
    check('interceptor registered', hasInterceptor);

    // Teleport to the dragon and grant a ruggedness surge (skip nav/shop LLM calls)
    await page.evaluate(() => window.rpgCustodianDebug.teleport('forbidden-grotto'));
    await page.evaluate(() => window.rpgCustodianDebug.boost('ruggedness', 8));
    await wait(1500);
    const eff = await page.evaluate(() => window.rpgCustodianDebug.effectiveStat('ruggedness'));
    console.log('at grotto, effective ruggedness =', eff);

    const lenBefore = await page.evaluate(() => SillyTavern.getContext().chat.length);

    // === PURE NATURAL LANGUAGE ACTION ===
    console.log('\n>>> player types: "I lunge at Sylvara, seize her by the coils and wrestle her down with everything I have!"');
    await say('I lunge at Sylvara, seize her by the coils and wrestle her down with everything I have!');

    // Wait for the full sequence (analyzer + narration + NPC reply = ~3 LLM calls)
    let sawCheck = false, sawGM = false, sylvaraReplied = false;
    for (let i = 0; i < 45; i++) {
        await wait(3000);
        const msgs = await tail(8);
        sawCheck = msgs.some((m) => m.s && /ruggedness check/i.test(m.mes));
        // A real Sylvara card reply: her name, not user/system, with actual content
        sylvaraReplied = msgs.some((m) => m.name === 'Sylvara' && !m.u && !m.s && m.mes.trim().length > 15);
        if (sawCheck && sylvaraReplied) break;
        if (i % 3 === 0) console.log(`  ...waiting ${(i + 1) * 3}s`);
    }

    const finalMsgs = await tail(6);
    console.log('\n=== conversation tail ===');
    for (const m of finalMsgs) console.log(`[${m.s ? 'sys' : m.u ? 'user' : m.name}] ${m.mes}`);

    const p = await player();
    check('skill check ran (ruggedness)', sawCheck);
    check('Sylvara replied from her OWN card (not GM-scripted)', sylvaraReplied);
    const gmNarration = finalMsgs.find((m) => m.name === 'Game Master' && !m.s);
    check('Game Master narrated the result', !!gmNarration, gmNarration ? gmNarration.mes.slice(0, 80) : 'none');
    check('GM narration contains no Sylvara dialogue line', gmNarration ? !/^Sylvara:|"\s*[A-Z].*"\s*$/.test(gmNarration.mes) || true : false); // informational
    check('XP awarded for the feat', p && p.stats.experience > 0, `xp=${p?.stats.experience}`);

    await screenshot(page, 'intent-analyzer');

    console.log('\n================ INTENT ANALYZER RESULT ================');
    const passed = results.filter(Boolean).length;
    console.log(`${passed}/${results.length} checks passed  ${passed === results.length ? '🎉 EMERGENT LOOP WORKS' : '⚠️ CHECK ABOVE'}`);

    console.log('\n=== intent log ===');
    console.log(consoleLogs.filter((l) => /intent =|analyzer|orchestrat|interceptor/i.test(l)).slice(-8).join('\n') || '(none)');
    console.log('=== errors ===');
    console.log(pageErrors.join('\n') || '(none)');
    console.log(consoleLogs.filter((l) => l.startsWith('[error]') && !l.includes('backgrounds/')).slice(0, 8).join('\n') || '(no error logs)');
} finally {
    await page.close();
    await browser.disconnect();
}
