// Regression (Seline hip-tease transcript): on a charm exchange with an
// addressed NPC, the GM narrator must NOT speak — no narrating her freezing
// smirk / retort / storming off before her own reply. The check line +
// interpretation note + her reply carry the outcome.
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
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town'));
    await wait(20000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('brothel')); await wait(1200);

    // Seed her presence in the story, then tease her (Dyna's actual line)
    await page.evaluate(() => {
        const c = SillyTavern.getContext();
        const m = { name: 'Seline', is_user: false, is_system: false, send_date: 'now', mes: 'Seline glides behind the bar, pouring two fingers of brandy, violet eyes fixed on you with amused appraisal. "Something on your mind, hired muscle?"' };
        c.chat.push(m); c.addOneMessage(m);
    });
    await wait(400);
    const s = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', '"Well, if you must ask, Seline…" I say, lifting my chin off my hands. "Those wide hips of yours bounced off at least three pieces of furniture on the way back to the bar. Makes me wonder what they are built for, if not walking straight."');
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 55; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2000);

    const intentLine = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('intent:', intentLine.replace(/^.*intent = /, '').slice(0, 220));
    const tail = await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).map(m => ({ w: m.is_user ? 'you' : (m.is_system ? 'sys' : m.name), mes: (m.mes || '').replace(/\s+/g, ' ') })), s);
    for (const m of tail) console.log(` [${m.w}] ${m.mes.slice(0, 120)}`);

    const charmRolled = /"stat":\s*"charm"/.test(intentLine);
    const gmProse = tail.filter(m => m.w === 'Game Master' && !/^\s*(🚶|⏰|🗓️|👀|📦|🎒|👁️|🎲)/.test(m.mes));
    const selineReplied = tail.some(m => m.w === 'Seline');
    check('charm check rolled on the tease', charmRolled);
    if (charmRolled) check('GM did NOT narrate her reaction (no GM prose in a charm exchange)', gmProse.length === 0, gmProse.map(g => g.mes.slice(0, 60)).join(' | '));
    check('Seline replied for herself', selineReplied);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
