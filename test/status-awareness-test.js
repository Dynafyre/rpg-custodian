// NPC status self-knowledge & lifecycle reactions:
//  - examine shows description + wear-off conditions/times
//  - a natural self-note is generated once at application and projected
//  - she reacts to gaining a status in her next reply (note consumed)
//  - timer expiry queues a worn-off reaction
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(18000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('shop')); await wait(1200);

    // apply a status in play (debug = in-play path, not the admin editor)
    await page.evaluate(() => window.rpgCustodianDebug.addStatus('Wren', { name: 'Glimmer Pox', kind: 'disease', polarity: 'negative', desc: 'itchy silver spots across her skin', mods: [{ stat: 'charm', amount: -1 }], duration: 6, end_condition: 'when treated with an herbal salve' }));
    check('application reaction queued', /taken hold/.test(await page.evaluate(() => window.rpgCustodianDebug.rel('Wren').statusReactionNote || '')));

    // self-note generates once, async
    let selfNote = '';
    for (let i = 0; i < 30; i++) { await wait(1500); selfNote = await page.evaluate(() => (window.rpgCustodianDebug.rel('Wren').customEffects || [])[0]?.selfNote || ''); if (selfNote) break; }
    console.log('selfNote:', selfNote.slice(0, 160));
    check('natural self-note generated at application', selfNote.length > 20);

    // examine shows desc + ends info
    const s1 = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.evaluate(() => { window.rpgCustodianDebug.examineNpc('Wren'); });
    await wait(12000);
    const readout = await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).filter(m => m.is_system).map(m => m.mes).join('\n'), s1);
    check('examine shows description', /itchy silver spots/.test(readout));
    check('examine shows wear-off time + condition', /periods left/.test(readout) && /herbal salve/.test(readout));

    // she reacts in her next reply; the note is consumed
    const s2 = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', '"Morning, Wren — how are you feeling today?" I ask gently.');
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 55; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2000);
    const wren = await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).filter(m => !m.is_user && !m.is_system && m.name === 'Wren').map(m => m.mes).join(' '), s2);
    console.log('Wren reacts:', wren.replace(/\s+/g, ' ').slice(0, 200));
    check('reaction note consumed by her reply', (await page.evaluate(() => window.rpgCustodianDebug.rel('Wren').statusReactionNote || null)) === null);
    console.log(`(behavioral: reply ${/itch|spot|pox|silver|skin|scratch|ill|sick/i.test(wren) ? 'DID' : 'did not clearly'} reference the affliction — flash-model dependent)`);

    // timer expiry queues a worn-off reaction
    await page.evaluate(() => window.rpgCustodianDebug.tick(7)); await wait(800);
    const wornNote = await page.evaluate(() => window.rpgCustodianDebug.rel('Wren').statusReactionNote || '');
    check('expiry queues a worn-off reaction', /worn off/.test(wornNote), wornNote.slice(0, 60));
    check('status actually expired', (await page.evaluate(() => (window.rpgCustodianDebug.rel('Wren').customEffects || []).length)) === 0);
    await page.evaluate(() => { const r = window.rpgCustodianDebug.rel('Wren'); r.statusReactionNote = null; });   // cleanup

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
