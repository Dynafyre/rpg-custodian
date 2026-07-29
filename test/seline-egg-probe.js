// For science: Seline — the entirely human madam of the Velvet Rose — is
// overdue with a single egg. Does the new band give her a coherent experience
// to play, does she read her own state correctly, and does the engine's birth
// verb fire from her laying it in natural language?
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const say = async (text) => {
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 60; i++) { await wait(2500); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(3000);
    return page.evaluate(() => (SillyTavern.getContext().chat || []).slice(-6).map(m => `[${m.name}${m.is_system ? '|sys' : ''}] ${(m.mes || '').replace(/\s+/g, ' ')}`));
};

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    // to the Velvet Rose, warm, and one egg long overdue
    await page.evaluate(() => window.rpgCustodianDebug.teleport('brothel')); await wait(1500);
    const setup = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        d.player().relationships['Seline'] = d.player().relationships['Seline'] || {};
        d.player().relationships['Seline'].affection = 8;
        d.setPreg('Seline', 1, 105, 'egg');
        return { band: d.pregBand('Seline', 'third'), own: d.pregBand('Seline', 'second'), tokens: d.tokens() };
    });
    console.log('WHAT OTHERS PERCEIVE:\n ', setup.band.label, '\n ', setup.band.band);
    console.log('\nWHAT SHE READS ABOUT HERSELF:\n ', setup.own.band);
    console.log('\nPower Tokens before:', setup.tokens);

    console.log('\n──── she is asked how she is doing ────');
    for (const line of await say(`"Seline — you look about ready to burst. How are you holding up?"`)) console.log(line.slice(0, 700));

    console.log('\n──── the laying itself ────');
    for (const line of await say(`I bolt the door and help her down onto the cushions. "It's time. I've got you — breathe, and push when your body tells you to."`)) console.log(line.slice(0, 900));

    const after = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const r = d.player().relationships['Seline'];
        return { pregs: r.pregnancies, prog: r.pregnancy_progress, kind: r.conceptionKind, tokens: d.tokens(), offspring: d.offspring(), band: d.pregBand('Seline', 'third') };
    });
    console.log('\nAFTER:', JSON.stringify({ pregnancies: after.pregs, progress: after.prog, tokens: after.tokens }));
    console.log('Offspring on record:', JSON.stringify(after.offspring));
    console.log('Band now:', after.band ? after.band.band : '(none — no longer carrying)');

    await page.evaluate(() => window.rpgCustodianDebug.setPreg('Seline', 0, 0, null));
} finally { await page.close(); await browser.disconnect(); }
