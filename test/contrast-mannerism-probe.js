// Probe for the "You X, most would Y" contrast mannerism at low affection.
// Two consecutive baited replies (refused drink, casual feat of strength —
// Dyna's exact triggers) at affection 0. Statistical mannerism → a 2-sample
// probe is a smoke test, not proof; full replies logged for eyeballing.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const FORMULA = /most (?:would|people|folk|men|travelers|customers)|(?:unlike|not like) (?:the )?others|others would(?:n't| not)?|anyone else would/i;

const say = async (text) => {
    const from = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 70; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2000);
    return await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).filter(m => m.name === 'Wren' && !m.is_system).map(m => m.mes).join(' '), from);
};

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(18000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('shop')); await wait(1000);
    await page.evaluate(() => { window.rpgCustodianDebug.setAffection('Wren', 0); window.rpgCustodianDebug.setArousal('Wren', 0); });

    const r1 = await say(`"No ale for me, thank you." I wave off the offered cup with a small shake of my head and stand easy at the counter, straight-backed despite three days on the road.`);
    console.log('\nReply 1:', r1.replace(/\s+/g, ' ').slice(0, 500), '\n');
    check('bait 1 (refused drink): no contrast formula', !FORMULA.test(r1), (r1.match(FORMULA) || [])[0]);

    const r2 = await say(`I heft the full water barrel by the door up onto one shoulder without breaking conversation. "Where do you want this, while I'm standing here?"`);
    console.log('\nReply 2:', r2.replace(/\s+/g, ' ').slice(0, 500), '\n');
    check('bait 2 (casual feat): no contrast formula', !FORMULA.test(r2), (r2.match(FORMULA) || [])[0]);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
