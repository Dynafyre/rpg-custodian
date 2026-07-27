// Regression: every New Game must open its own fresh group chat.
// Old bug: clearChat() only wiped the DOM, so a new playthrough continued
// inside (and re-saved) the previous playthrough's chat log.
// Also verifies: no member greetings are seeded, live cards are greeting-less.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));

const groupInfo = () => page.evaluate(() => {
    const c = SillyTavern.getContext();
    const g = (c.groups || []).find(x => x.id === c.groupId);
    return g ? { id: g.id, chatId: g.chat_id, chats: [...g.chats] } : null;
});
const chatMsgs = () => page.evaluate(() =>
    (SillyTavern.getContext().chat ?? []).map(m => ({
        name: m.name, sys: !!m.is_system, mes: (m.mes ?? '').slice(0, 80),
    })));
const newGame = async () => {
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town'));
    await wait(20000);
};

let failures = 0;
const check = (label, ok) => { console.log(`${ok ? '✅' : '❌'} ${label}`); if (!ok) failures++; };

try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
    await wait(6000);

    // ---- Playthrough #1 ----
    await newGame();
    const g1 = await groupInfo();
    const msgs1 = await chatMsgs();
    console.log('game 1:', JSON.stringify(g1), `${msgs1.length} msg(s)`);
    check('game 1 opened a group', !!g1);
    check('game 1 chat starts with only the intro', msgs1.length === 1 && msgs1[0].mes.includes('New Game Started'));
    check('no greeting messages seeded', !msgs1.some(m => /wiping a mug|Game Master Ready|arrow thuds/i.test(m.mes)));

    // Plant a marker so we can prove game 2 does not inherit this log
    await page.evaluate(async () => {
        const c = SillyTavern.getContext();
        const m = { name: 'Reigngard', is_user: true, send_date: 'now', mes: 'MARKER-OLD-PLAYTHROUGH' };
        c.chat.push(m); c.addOneMessage(m); await c.saveChat();
    });
    await wait(1000);

    // ---- Playthrough #2, same world ----
    await newGame();
    const g2 = await groupInfo();
    const msgs2 = await chatMsgs();
    console.log('game 2:', JSON.stringify(g2), `${msgs2.length} msg(s)`);
    check('same group reused', g2.id === g1.id);
    check('game 2 is a NEW chat file', g2.chatId !== g1.chatId);
    check('old playthrough kept as past chat', g2.chats.includes(g1.chatId));
    check('marker not inherited', !msgs2.some(m => m.mes.includes('MARKER-OLD-PLAYTHROUGH')));
    check('game 2 chat is only the intro', msgs2.length === 1 && msgs2[0].mes.includes('New Game Started'));

    // ---- Cards are greeting-less after self-heal ----
    const greetings = await page.evaluate(() => {
        const cast = ['Game Master', 'Bryony', 'Fern', 'Marta', 'Seline', 'Sylvara', 'Wren'];
        return SillyTavern.getContext().characters
            .filter(c => cast.includes(c.name))
            .map(c => ({ name: c.name, fm: c.data?.first_mes || c.first_mes || '', alts: (c.data?.alternate_greetings || []).filter(Boolean).length }));
    });
    console.log('cards:', JSON.stringify(greetings));
    check('all RPG cards greeting-less', greetings.length > 0 && greetings.every(c => !c.fm && !c.alts));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
