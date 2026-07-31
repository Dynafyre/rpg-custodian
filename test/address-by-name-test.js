// Dyna's bug: the GM narrated instead of the NPC answering, even when he
// addressed her by name — and "Evelina" in particular never got a word in.
//
// Cause: cast cards carry full names ("Evelina Celeste", "Florence the
// Formless") and the detector required the WHOLE string, so typing "Evelina"
// matched nobody. With no target, orchestration falls through to GM narration.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const addressed = (t) => page.evaluate((x) => window.rpgCustodianDebug.addressed(x), t);

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);

    // Put Dyna's actual multi-word cast in the room alongside single-word Bryony
    await page.evaluate(() => {
        const st = window.rpgCustodianDebug.state();
        const here = st.currentLocation;
        const sched = { Morning: here, Day: here, Evening: here, Night: here };
        for (const name of ['Evelina Celeste', 'Florence the Formless']) {
            if (!st.npcRoster.some(n => n.name === name)) {
                st.npcRoster.push({ name, role: 'maid', description: '', schedule: sched, homeLocation: here, race: 'elf', age: '311' });
            }
        }
    });
    const here = await page.evaluate(() => window.rpgCustodianDebug.state().npcRoster.filter(n => true).map(n => n.name));
    console.log('roster:', JSON.stringify(here));

    // ── the reported failure ──────────────────────────────────────────────
    check('addressing "Evelina" finds Evelina Celeste', (await addressed('Evelina, could you fetch the good silver?')).includes('Evelina Celeste'), JSON.stringify(await addressed('Evelina, could you fetch the good silver?')));
    check('the full name still works', (await addressed('Evelina Celeste, a word please.')).includes('Evelina Celeste'));
    check('a surname alone works', (await addressed('Celeste, come here.')).includes('Evelina Celeste'));
    check('mid-sentence works too', (await addressed('I hand the tray to Evelina and step back.')).includes('Evelina Celeste'));
    check('possessives work', (await addressed("I pick up Evelina's ledger.")).includes('Evelina Celeste'));
    check('"Florence" finds Florence the Formless', (await addressed('Florence, are you there?')).includes('Florence the Formless'), JSON.stringify(await addressed('Florence, are you there?')));
    check('short particles are not aliases ("the" must not match everyone)', !(await addressed('I open the door.')).length, JSON.stringify(await addressed('I open the door.')));

    // single-word cast still behave
    check('single-word names still match', (await addressed('Bryony, anything on the trails?')).includes('Bryony'));
    check('an unrelated line addresses nobody', !(await addressed('I stretch and look at the sky.')).length);

    // the analyzer's target resolves through the same rules
    check('resolveNpcName maps a short name to the roster name', await page.evaluate(() => window.rpgCustodianDebug.resolveNpc('Evelina')) === 'Evelina Celeste');
    check('resolveNpcName leaves a full name alone', await page.evaluate(() => window.rpgCustodianDebug.resolveNpc('Bryony')) === 'Bryony');
    check('resolveNpcName rejects someone absent', await page.evaluate(() => window.rpgCustodianDebug.resolveNpc('Marta')) === null);

    // ── ambiguity guard: a shared part must NOT auto-target ───────────────
    await page.evaluate(() => {
        const st = window.rpgCustodianDebug.state();
        const here = st.currentLocation;
        const sched = { Morning: here, Day: here, Evening: here, Night: here };
        if (!st.npcRoster.some(n => n.name === 'Evelina Vance')) {
            st.npcRoster.push({ name: 'Evelina Vance', role: 'maid', description: '', schedule: sched, homeLocation: here });
        }
    });
    const ambiguous = await addressed('Evelina, over here!');
    console.log('with two Evelinas present:', JSON.stringify(ambiguous));
    check('a shared first name is not claimed by either woman', ambiguous.length === 0, JSON.stringify(ambiguous));
    check('but the full name still picks the right one', (await addressed('Evelina Celeste, over here!')).includes('Evelina Celeste'));

    // ── several named at once answer in the order they were named ─────────
    await page.evaluate(() => {
        const st = window.rpgCustodianDebug.state();
        const here = st.currentLocation;
        const sched = { Morning: here, Day: here, Evening: here, Night: here };
        for (const n of st.npcRoster) if (['Marta', 'Wren', 'Seline'].includes(n.name)) { n.schedule = sched; n.homeLocation = here; }
    });
    check('all three named are detected', (await addressed('Marta, Wren and Seline — over here.')).length === 3, JSON.stringify(await addressed('Marta, Wren and Seline — over here.')));
    const order1 = await addressed('Marta, Wren and Seline — over here.');
    check('they answer in the order named', JSON.stringify(order1) === JSON.stringify(['Marta', 'Wren', 'Seline']), JSON.stringify(order1));
    const order2 = await addressed('Seline, then Wren, then Marta.');
    check('a different order is honoured, not roster order', JSON.stringify(order2) === JSON.stringify(['Seline', 'Wren', 'Marta']), JSON.stringify(order2));
    const order3 = await addressed('I ask Wren about the price, and Marta about the room.');
    check('mid-sentence mentions order by position too', JSON.stringify(order3) === JSON.stringify(['Wren', 'Marta']), JSON.stringify(order3));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
