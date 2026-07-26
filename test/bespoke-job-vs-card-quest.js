// Regression (Dyna's brothel-guard transcript): accepting a job an NPC
// invented IN DIALOGUE must become a bespoke add_objective. The pre-authored
// card-quest system (accept_quest by id — the wolves-quest collision) has
// been DEMOLISHED; this asserts nothing recreates its state.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

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
    console.log('legacy cleanup:', await page.evaluate(() => window.rpgCustodianDebug.clearLegacyQuests()));

    // Seed the dialogue: Bryony invents a brothel-guard job (NOT her card quest)
    await page.evaluate(() => {
        const c = SillyTavern.getContext();
        const m = { name: 'Bryony', is_user: false, is_system: false, send_date: 'now', mes: '"The Madam at the Velvet Rose needs a deterrent — someone big to sit by the bar and glare, break fingers if anyone gets handsy with the girls. Pays ten gold for the night. You want the job or not?"' };
        c.chat.push(m); c.addOneMessage(m);
    });
    await wait(400);
    const s = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', '"Yeah, I can do that. Beats hauling hay-bales — I\'ll take the guard job at the Velvet Rose tonight," I tell Bryony.');
    await page.keyboard.press('Enter');
    let sawBusy = false;
    for (let i = 0; i < 50; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sawBusy = true; if (sawBusy && !b) break; }
    await wait(2000);

    const intentLine = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('intent:', intentLine.replace(/^.*intent = /, '').slice(0, 300));
    const legacyState = await page.evaluate(() => window.rpgCustodianDebug.player().quests || null);
    const objectives = await page.evaluate(() => (window.rpgCustodianDebug.player().customEffects || []).filter(e => e.category === 'quest').map(e => ({ name: e.name, end: e.endCondition, reward: e.reward })));
    console.log('legacy quest state:', JSON.stringify(legacyState));
    console.log('bespoke objectives:', JSON.stringify(objectives));
    check('no legacy card-quest state recreated', !legacyState || !Object.keys(legacyState).length);
    check('bespoke guard objective created via add_objective', objectives.some(o => /guard|velvet|rose|brothel|deterrent/i.test(`${o.name} ${o.end || ''}`)));
    const tail = await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).filter(m => m.is_system).map(m => (m.mes || '').replace(/\s+/g, ' ').slice(0, 100)), s);
    for (const l of tail) console.log(' [sys]', l);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
