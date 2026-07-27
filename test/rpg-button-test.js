/**
 * Complete first-run onboarding (if shown), then test the RPG menu button:
 * click it and verify we actually get switched into the Game Master chat.
 */
import { connect, collectLogs, login, screenshot } from './harness.js';

const browser = await connect();
const page = await browser.newPage();
const { consoleLogs, pageErrors } = collectLogs(page);

try {
    await login(page);

    // Dismiss the first-run welcome dialog if it's up (modal <dialog> makes
    // the rest of the page inert, so nothing works until it's closed).
    const dismissed = await page.evaluate(() => {
        const dlg = document.querySelector('dialog[open]');
        if (!dlg) return 'no-dialog';
        const save = [...dlg.querySelectorAll('.menu_button, .popup-button-ok, input[type=submit]')]
            .find((b) => /save|ok/i.test(b.textContent || b.value || ''));
        if (save) { save.click(); return 'clicked-save'; }
        dlg.close();
        return 'force-closed';
    });
    console.log('WELCOME DIALOG:', dismissed);
    await new Promise((r) => setTimeout(r, 3000));

    // Belt and suspenders: close any remaining open dialog.
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await screenshot(page, '03-onboarded');

    const before = await page.evaluate(() => ({
        chatId: SillyTavern.getContext().chatId ?? null,
        characterId: SillyTavern.getContext().characterId ?? null,
    }));
    console.log('BEFORE CLICK:', JSON.stringify(before));

    await page.click('#rpg-menu-button');
    await new Promise((r) => setTimeout(r, 8000));
    await screenshot(page, '04-after-rpg-click');

    const after = await page.evaluate(() => {
        const ctx = SillyTavern.getContext();
        return {
            chatId: ctx.chatId ?? null,
            characterId: ctx.characterId ?? null,
            characterName: ctx.characters?.[ctx.characterId]?.name ?? null,
            chatLength: ctx.chat?.length ?? null,
            firstMessagePreview: ctx.chat?.[0]?.mes?.slice(0, 200) ?? null,
        };
    });
    console.log('AFTER CLICK:', JSON.stringify(after, null, 2));

    console.log('\n=== RPG console lines ===');
    console.log(consoleLogs.filter((l) => /rpg|custodian|game master/i.test(l)).join('\n') || '(none)');
    console.log('\n=== Page errors ===');
    console.log(pageErrors.join('\n') || '(none)');
} finally {
    await page.close();
    await browser.disconnect();
}
