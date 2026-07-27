/**
 * Gating smoke test: confirm DeepSeek is CONNECTED and genuinely generates.
 * Distinguishes real generation from the cast's static greetings by (a) checking
 * onlineStatus and (b) requiring a NEW message appended after our input.
 */
import { connect, collectLogs, login, screenshot } from './harness.js';

const browser = await connect();
const page = await browser.newPage();
const { consoleLogs, pageErrors } = collectLogs(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const status = () => page.evaluate(() => SillyTavern.getContext().onlineStatus);
const chatLen = () => page.evaluate(() => SillyTavern.getContext().chat.length);
const tail = (n) => page.evaluate((c) => (SillyTavern.getContext().chat ?? []).slice(-c)
    .map((m) => ({ name: m.name, u: !!m.is_user, s: !!m.is_system, mes: (m.mes ?? '').slice(0, 200) })), n);

try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));

    // Wait for auto-connect to settle.
    let st = 'no_connection';
    for (let i = 0; i < 12; i++) { st = await status(); if (st && st !== 'no_connection') break; await wait(2500); }
    console.log('ONLINE STATUS:', st);

    await page.click('#rpg-menu-button');
    await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')]
        .find((el) => el.textContent.includes('New Game'))?.click());
    await wait(22000);

    const lenBefore = await chatLen();
    console.log('chat len before input:', lenBefore);

    await page.type('#send_textarea', 'Bryony, well met. I mean no trouble — I am simply new to this town.');
    await page.keyboard.press('Enter');

    // Real generation = chat grows past lenBefore+1 (our user msg) with an assistant message.
    let grew = false, newMsg = null;
    for (let i = 0; i < 40; i++) {
        await wait(3000);
        const len = await chatLen();
        if (len > lenBefore + 1) {
            const t = await tail(3);
            newMsg = t.reverse().find((m) => !m.u && !m.s && m.mes.length > 0);
            if (newMsg) { grew = true; break; }
        }
        if (i % 4 === 0) console.log(`  ...waiting ${(i + 1) * 3}s (len=${len})`);
    }

    await screenshot(page, 'llm-02-reply');
    console.log('\nLAST 3:', JSON.stringify(await tail(3), null, 1));
    console.log('\nRESULT:', grew
        ? `PASS — live generation. "${newMsg.name}": ${newMsg.mes.slice(0, 140)}`
        : `FAIL — no new generated message (status=${st})`);

    console.log('\n=== relevant logs ===');
    console.log(consoleLogs.filter((l) => /deepseek|connect|error|401|403|429|quota|model|status/i.test(l)).slice(-20).join('\n') || '(none)');
    console.log('=== page errors ===');
    console.log(pageErrors.join('\n') || '(none)');
} finally {
    await page.close();
    await browser.disconnect();
}
