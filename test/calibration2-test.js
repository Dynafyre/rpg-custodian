// Round-2 live-play calibration repros (Dyna's Bryony transcript):
//  1. Cast directory in the status block — absent NPCs' names/roles are common
//     knowledge (no more "Fern's girls" for Seline's brothel).
//  2. Composite acceptance ("I'll take the job — lead the way") emits
//     add_objective ALONGSIDE the travel, never dropped.
//  3. Unprompted crude innuendo from her = minimum +1 arousal.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const pushReply = (name, mes) => page.evaluate(([n, m]) => {
    const c = SillyTavern.getContext();
    const msg = { name: n, is_user: false, is_system: false, send_date: 'now', mes: m };
    c.chat.push(msg); c.addOneMessage(msg);
    return c.chat.length;
}, [name, mes]);

try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
    await wait(6000);
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('New Game'))?.click());
    await wait(20000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1000);

    // ---- 1) Common-knowledge cast directory in the status block ----
    const status = await page.evaluate(() => SillyTavern.getContext().extensionPrompts?.['RPG_CUSTODIAN_STATUS']?.value || '');
    check('directory present in status block', /Common local knowledge/.test(status));
    check('Seline the madam is common knowledge', /Seline, the madam/.test(status));
    check('all six cast listed', ['Bryony', 'Fern', 'Marta', 'Seline', 'Sylvara', 'Wren'].every(n => status.includes(n)));

    // ---- 2) Composite acceptance: job + lead-the-way (Dyna's exact message) ----
    await pushReply('Bryony', '"The Madam at the Velvet Rose needs a deterrent — someone big to sit by the bar and glare, break fingers if anyone gets handsy. Pays ten gold for the night. You want the job or not? Madam\'s expecting me to send someone competent."');
    await wait(400);
    await page.type('#send_textarea', '"Yeah. I can do that. Beats hauling hay-bales. Could you lead the way and explain our arrangement to the Madam so she knows I\'m accountable to you? I want to make a good impression." Dyna answers Bryony.');
    await page.keyboard.press('Enter');
    let sawBusy = false;
    for (let i = 0; i < 55; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sawBusy = true; if (sawBusy && !b) break; }
    await wait(2000);
    const intentLine = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('intent:', intentLine.replace(/^.*intent = /, '').slice(0, 320));
    const objectives = await page.evaluate(() => (window.rpgCustodianDebug.player().customEffects || []).filter(e => e.category === 'quest').map(e => e.name));
    console.log('objectives:', JSON.stringify(objectives));
    check('composite acceptance still creates the objective', objectives.length > 0, objectives.join(','));
    const locAfter = await page.evaluate(() => window.rpgCustodianDebug.state().currentLocation);
    check('travel routed to the TRUE destination (brothel), not one hop', locAfter === 'brothel', `loc=${locAfter}`);

    // ---- 2b) Enter-while-looking must still move (Dyna's brothel repro) ----
    await page.evaluate(() => window.rpgCustodianDebug.teleport('town-square')); await wait(800);
    await page.type('#send_textarea', 'Dyna enters the Brothel with Bryony in tow. Looking around the place and the Madam.');
    await page.keyboard.press('Enter');
    let sb2 = false;
    for (let i = 0; i < 55; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb2 = true; if (sb2 && !b) break; }
    await wait(2000);
    const intent2 = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('intent2:', intent2.replace(/^.*intent = /, '').slice(0, 260));
    const locEnter = await page.evaluate(() => window.rpgCustodianDebug.state().currentLocation);
    check('entering while looking around still moves the engine', locEnter === 'brothel', `loc=${locEnter}`);

    // ---- 3) Her unprompted innuendo → minimum +1 arousal ----
    await page.evaluate(() => { window.rpgCustodianDebug.setAffection('Bryony', 2); window.rpgCustodianDebug.setArousal('Bryony', 1); });
    const p = await pushReply('Bryony', 'Bryony snorts, pushing off the fence. "Accountable to me? Don\'t get ideas, muscle-for-hire. You\'re accountable to the Madam\'s coin, same as anyone." She strides past him close enough that her vest creaks, hips swaying, and glances back over her shoulder. "Fair warning — the girls there are friendly. Don\'t get distracted. You\'re there to look mean, not get your cock wet." A pause; her scarred lip twitches. "Unless you\'ve got coin. Then what you do after your shift is your own damn business."');
    await page.evaluate(l => window.rpgCustodianDebug.judgeReaction('Bryony', l - 1), p); await wait(500);
    const r = await page.evaluate(() => { const x = window.rpgCustodianDebug.rel('Bryony'); return { aff: x.affection || 0, aro: x.arousal || 1 }; });
    const judgeLog = (consoleLogs.filter(l => l.includes('reaction judge Bryony')).slice(-1)[0] || '').slice(-120);
    console.log('judge:', judgeLog);
    check('unprompted cock-talk → arousal at least +1', r.aro >= 2, `aro=${r.aro}`);
    check('businesslike tone → affection unchanged', r.aff === 2, `aff=${r.aff}`);
    const lastSys = await page.evaluate(() => [...SillyTavern.getContext().chat].reverse().find(m => m.is_system)?.mes || '');
    console.log('ghost:', lastSys.slice(0, 120));
    check('increment shown to player as system message', /arousal \+\d/.test(lastSys));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
