/**
 * First exploration run: log in as claude-headless, verify RPG Custodian
 * loads, inspect the RPG menu button, click it, and report everything.
 */
import { connect, collectLogs, login, screenshot } from './harness.js';

const browser = await connect();
const page = await browser.newPage();
const { consoleLogs, pageErrors } = collectLogs(page);

try {
    await login(page);
    await screenshot(page, '01-logged-in');

    const probe = await page.evaluate(() => {
        const btn = document.getElementById('rpg-menu-button');
        return {
            currentUser: document.querySelector('#user_avatar_block .avatar')?.title ?? null,
            rightSendFormExists: !!document.getElementById('rightSendForm'),
            rpgButtonExists: !!btn,
            rpgButtonVisible: btn ? btn.offsetParent !== null : false,
            extensionSettingsLoaded: typeof SillyTavern !== 'undefined'
                && !!SillyTavern.getContext?.()?.extensionSettings,
            thirdPartyScripts: [...document.querySelectorAll('script')]
                .map((s) => s.src).filter((s) => s.includes('third-party')),
        };
    });
    console.log('PROBE:', JSON.stringify(probe, null, 2));

    if (probe.rpgButtonExists) {
        await page.click('#rpg-menu-button');
        await new Promise((r) => setTimeout(r, 8000));
        await screenshot(page, '02-after-rpg-click');
        const after = await page.evaluate(() => ({
            chatName: document.querySelector('#selected_chat_pole')?.value
                ?? SillyTavern.getContext?.()?.chatId ?? null,
            groupCount: SillyTavern.getContext?.()?.groups?.length ?? null,
            characterNames: (SillyTavern.getContext?.()?.characters ?? []).map((c) => c.name),
        }));
        console.log('AFTER-CLICK:', JSON.stringify(after, null, 2));
    }

    console.log('\n=== RPG console lines ===');
    console.log(consoleLogs.filter((l) => /rpg|custodian/i.test(l)).join('\n') || '(none)');
    console.log('\n=== Page errors ===');
    console.log(pageErrors.join('\n') || '(none)');
    console.log('\n=== Console errors (all) ===');
    console.log(consoleLogs.filter((l) => l.startsWith('[error]')).slice(0, 20).join('\n') || '(none)');
} finally {
    await page.close();
    await browser.disconnect();
}
