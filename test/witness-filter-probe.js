// Measures the ONE guarantee witness-filtering exists to provide:
// at the moment a character is drafted to speak, every message she did not
// witness must be hidden (is_system=true) so it cannot reach her prompt.
//
// We hook GROUP_MEMBER_DRAFTED ourselves and inspect the chat the instant
// after the filtering extension has had its turn. Deterministic — no LLM
// judgement involved.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const say = async (text) => {
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 50; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2000);
};

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    // Install the audit: on every draft, record whether the drafted character
    // can still see messages she never witnessed.
    await page.evaluate(() => {
        const c = SillyTavern.getContext();
        window.__audit = [];
        c.eventSource.on(c.eventTypes.GROUP_MEMBER_DRAFTED, (chId) => {
            const avatar = c.characters[chId]?.avatar;
            const leaked = [];
            (c.chat || []).forEach((m, i) => {
                const present = m.present || [];
                const witnessed = present.includes(avatar) || present.includes('presence_universal_tracker');
                if (!witnessed && !m.is_system) leaked.push({ i, name: m.name, present });
            });
            window.__audit.push({ avatar, total: (c.chat || []).length, leaked: leaked.length, sample: leaked.slice(-3) });
        });
    });

    // Build a private moment with Bryony, then go and speak to Wren elsewhere.
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);
    await say(`"Bryony — just between us: I buried a silver key by the old fence post."`);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('shop')); await wait(1800);
    await page.evaluate(() => { window.__audit = []; });
    await say(`"Wren, anything worth hearing today?"`);

    const audit = await page.evaluate(() => window.__audit);
    console.log('\ndraft audit:', JSON.stringify(audit, null, 1).slice(0, 900));
    const wrenDrafts = audit.filter(a => /Wren/i.test(a.avatar || ''));
    check('Wren was actually drafted', wrenDrafts.length > 0, JSON.stringify(audit.map(a => a.avatar)));
    for (const d of wrenDrafts) {
        check(`at Wren's draft, nothing she never witnessed is left visible`, d.leaked === 0,
            `${d.leaked} of ${d.total} unhidden — e.g. ${JSON.stringify(d.sample.map(s => `${s.i}:${s.name}`))}`);
    }

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
