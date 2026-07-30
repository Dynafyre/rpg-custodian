// Day-specific weekly timetables (for cast with a job or a school week):
//  1. presence follows the WEEKDAY, not just the time of day
//  2. each slot's 30-char note says what she is doing, and reaches her context
//  3. reunions list what she actually did across the absence
//  4. cast editor: toggle + accordion + per-day copy, saved and live-applied
//  5. Home no longer overwrites an authored schedule (Dyna's complaint)
//  6. cast WITHOUT a weekly table keep the simple daily routine untouched
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);

    // A scratch world with three rooms and one working girl
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        const s = ctx.extensionSettings['rpg-custodian'];
        s.authoredWorlds = s.authoredWorlds || {};
        delete s.authoredWorlds['weekly-proof'];
        s.authoredWorlds['weekly-proof'] = {
            worldId: 'weekly-proof', name: 'Weekly Proof', description: 'timetable test world',
            startingLocation: 'hall',
            locations: {
                hall: { name: 'Great Hall', description: 'A hall.', connections: ['laundry', 'school'], background: '' },
                laundry: { name: 'Laundry', description: 'Steam and soap.', connections: ['hall'], background: '' },
                school: { name: 'Schoolhouse', description: 'Chalk dust.', connections: ['hall'], background: '' },
            },
            cast: [], castData: {},
        };
        ctx.saveSettingsDebounced();
        await window.rpgCustodianDebug.refreshWorlds();
        window.rpgCustodianDebug.adoptCast('weekly-proof', 'Trizel');
    });

    // ── 5. Home must NOT overwrite an authored schedule ───────────────────
    await page.evaluate(() => window.rpgCustodianDebug.castForm('weekly-proof', 'Trizel')); await wait(700);
    await page.evaluate(() => {
        $('.cf-period[data-p="Morning"]').val('laundry');
        $('.cf-period[data-p="Day"]').val('school');
    });
    await page.evaluate(() => { $('#cf-home').val('hall').trigger('change'); }); await wait(300);
    const afterHome = await page.evaluate(() => ({ m: $('.cf-period[data-p="Morning"]').val(), d: $('.cf-period[data-p="Day"]').val() }));
    check('changing Home leaves the authored schedule alone', afterHome.m === 'laundry' && afterHome.d === 'school', JSON.stringify(afterHome));

    // ── 4. the weekly accordion ───────────────────────────────────────────
    const hiddenFirst = await page.evaluate(() => $('#cf-week').is(':visible'));
    check('weekly timetable is off by default (dragons and hermits unaffected)', hiddenFirst === false);
    await page.evaluate(() => $('#cf-weekly').trigger('click')); await wait(300);
    const shown = await page.evaluate(() => ({ vis: $('#cf-week').is(':visible'), days: $('.cf-day').length, slots: $('.cf-wloc').length, notes: $('.cf-wnote').length, max: $('.cf-wnote').first().attr('maxlength') }));
    check('toggle opens 7 days × 4 slots with a note box each', shown.vis && shown.days === 7 && shown.slots === 28 && shown.notes === 28, JSON.stringify(shown));
    check('note boxes cap at 30 characters', shown.max === '30', String(shown.max));

    // author a work week: laundry mornings, school days; Sunday off at the hall
    await page.evaluate((WD) => {
        for (const d of WD) {
            const workday = d !== 'Sunday';
            $(`.cf-wloc[data-d="${d}"][data-p="Morning"]`).val(workday ? 'laundry' : 'hall');
            $(`.cf-wnote[data-d="${d}"][data-p="Morning"]`).val(workday ? 'folding laundry' : 'resting at last');
            $(`.cf-wloc[data-d="${d}"][data-p="Day"]`).val(workday ? 'school' : 'hall');
            $(`.cf-wnote[data-d="${d}"][data-p="Day"]`).val(workday ? 'teaching the little ones' : 'reading by the fire');
        }
        $('#cf-save').trigger('click');
    }, WEEKDAYS); await wait(900);

    const saved = await page.evaluate(() => {
        const rc = SillyTavern.getContext().extensionSettings['rpg-custodian'].authoredWorlds['weekly-proof'].castData['Trizel'].extensions.rpg_custodian;
        return { on: !!rc.weekly_enabled, mon: rc.schedule_weekly?.Monday?.Morning, sun: rc.schedule_weekly?.Sunday?.Morning, simpleM: rc.schedule?.Morning };
    });
    check('weekly table saves per weekday with notes', saved.on && saved.mon?.loc === 'laundry' && saved.mon?.note === 'folding laundry' && saved.sun?.loc === 'hall', JSON.stringify(saved));
    check('the simple daily schedule is still saved as the fallback', saved.simpleM === 'laundry', String(saved.simpleM));

    // ── 1 & 2. play it: presence follows the weekday, note reaches context ──
    await page.evaluate(() => window.rpgCustodianDebug.newGame('weekly-proof')); await wait(20000);
    const today = await page.evaluate(() => window.rpgCustodianDebug.weekday());
    const slotNow = await page.evaluate(() => window.rpgCustodianDebug.slot('Trizel'));
    const expectMorning = today === 'Sunday' ? 'hall' : 'laundry';
    check(`Day 1 is ${today}: morning slot resolves correctly`, slotNow.loc === expectMorning, JSON.stringify(slotNow));
    check('slot carries her activity note', !!slotNow.note, slotNow.note);

    // walk to her and read the injected context
    await page.evaluate((loc) => window.rpgCustodianDebug.teleport(loc), expectMorning); await wait(1500);
    const ctxText = await page.evaluate(() => window.rpgCustodianDebug.statusText());
    check('her current activity is injected for her to play', /Right now she is (folding laundry|resting at last)/.test(ctxText), (ctxText.match(/Right now she is [^.]*/) || [''])[0]);
    check('self-knowledge names today by weekday', new RegExp(`${today}s go`).test(ctxText), (ctxText.match(/Trizel — [^\n]{0,90}/) || [''])[0]);

    // a DIFFERENT weekday must move her (Sunday off vs a work morning)
    const sundayLoc = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const cur = d.weekday();
        let day = d.state().dayCount;
        for (let i = 0; i < 8; i++) { if (d.weekday(day) === 'Sunday') break; day++; }
        return { day, wd: d.weekday(day), slot: d.slot('Trizel', day, 'Morning') };
    });
    check('her Sunday differs from her work week', sundayLoc.wd === 'Sunday' && sundayLoc.slot.loc === 'hall' && /resting/.test(sundayLoc.slot.note), JSON.stringify(sundayLoc));

    // ── 3. reunion lists what she actually did ────────────────────────────
    const pursuits = await page.evaluate(() => window.rpgCustodianDebug.pursuits('Trizel', 8));
    check('absence walk collects concrete pursuits', pursuits.length > 0 && /at (the )?(Laundry|Schoolhouse|Great Hall)/.test(pursuits.join(' | ')), pursuits.join(' | '));
    const reunion = await page.evaluate(() => { const r = window.rpgCustodianDebug.player().relationships['Trizel']; r.lastSeenStep = -8; return window.rpgCustodianDebug.reunionNote('Trizel'); });
    check('reunion note tells her what she was doing while he was away', /your timetable had you/.test(reunion || ''), (String(reunion).match(/your timetable had you[^.]*/) || [''])[0].slice(0, 130));

    // ── 6. a cast member with no weekly table is untouched ────────────────
    const plain = await page.evaluate(() => {
        const npc = window.rpgCustodianDebug.state().npcRoster.find(n => n.name === 'Trizel');
        return { weekly: !!npc.weeklyEnabled, simple: window.rpgCustodianDebug.slot('Trizel', 1, 'Night') };
    });
    check('non-weekly slots still fall back to the simple routine', !!plain.simple.loc, JSON.stringify(plain.simple));

    // ── mobile pass ───────────────────────────────────────────────────────
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    for (let i = 0; i < 20; i++) { if (await page.evaluate(() => !!window.rpgCustodianDebug).catch(() => false)) break; await wait(2000); }
    await page.evaluate(() => window.rpgCustodianDebug.castForm('weekly-proof', 'Trizel')); await wait(800);
    await page.evaluate(() => { $('.cf-day').first().attr('open', 'open'); }); await wait(200);
    const mob = await page.evaluate(() => {
        const out = {};
        for (const sel of ['#cf-weekly', '.cf-day', '.cf-wloc', '.cf-wnote']) {
            const r = document.querySelector(sel)?.getBoundingClientRect();
            out[sel] = r ? { onX: r.left >= -1 && r.right <= 391, w: Math.round(r.width) } : null;
        }
        return out;
    });
    check('mobile: weekly controls fit 390px without x-overflow', Object.values(mob).every(v => v && v.onX), JSON.stringify(mob));
    // copy-to-week works by TOUCH
    const copied = await page.evaluate(() => {
        $(`.cf-wnote[data-d="Monday"][data-p="Night"]`).val('darning socks');
        $(`.cf-copyday[data-d="Monday"]`)[0].click();
        return $(`.cf-wnote[data-d="Friday"][data-p="Night"]`).val();
    });
    check('copy-this-day-to-the-week fills the other days', copied === 'darning socks', String(copied));

    await page.evaluate(async () => {
        $('#cf-cancel').trigger('click');
        const ctx = SillyTavern.getContext();
        delete ctx.extensionSettings['rpg-custodian'].authoredWorlds['weekly-proof'];
        await window.rpgCustodianDebug.refreshWorlds();
        ctx.saveSettingsDebounced();
    });

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
