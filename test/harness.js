/**
 * Headless test harness for RPG Custodian.
 * Connects to a running headless Chromium (CDP on :9222), logs into the live
 * SillyTavern server as the claude-headless test user, and returns a ready page.
 *
 * Start the browser first:
 *   flatpak run io.github.ungoogled_software.ungoogled_chromium \
 *     --headless=new --remote-debugging-port=9222 \
 *     --user-data-dir=/tmp/rpgc-chrome-profile --no-first-run about:blank
 */
import puppeteer from 'puppeteer-core';

export const ST_URL = 'http://localhost:8000';
export const TEST_USER = 'claude-headless';
export const TEST_PASS = 'testing';

export async function connect() {
    const browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
        defaultViewport: { width: 1600, height: 900 },
    });
    return browser;
}

/**
 * Attach console/error collectors to a page.
 * Returns the log arrays, which fill up as the page runs.
 */
export function collectLogs(page) {
    const consoleLogs = [];
    const pageErrors = [];
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    return { consoleLogs, pageErrors };
}

/**
 * Navigate to SillyTavern and get past the login screen if one appears.
 */
export async function login(page) {
    await page.goto(ST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Either we land on the login page or straight in the app (session cookie).
    const state = await Promise.race([
        page.waitForSelector('#send_textarea', { timeout: 45000 }).then(() => 'app'),
        page.waitForSelector('.userSelect, #userHandle, #loginButton', { timeout: 45000 }).then(() => 'login'),
    ]);

    if (state === 'login') {
        // Prefer clicking the user tile if the discreet-login list is shown.
        const tile = await page.evaluateHandle((handle) => {
            const tiles = [...document.querySelectorAll('.userSelect')];
            return tiles.find((t) => t.textContent.toLowerCase().includes(handle)) ?? null;
        }, TEST_USER);
        if (tile && tile.asElement()) {
            await tile.asElement().click();
        } else {
            const handleInput = await page.$('#userHandle');
            if (handleInput) await handleInput.type(TEST_USER);
        }
        const passInput = await page.$('#userPassword');
        if (passInput) await passInput.type(TEST_PASS);
        await page.click('#loginButton');
        await page.waitForSelector('#send_textarea', { timeout: 60000 });
    }

    // Give extensions time to initialize after the app shell is up.
    await new Promise((r) => setTimeout(r, 6000));
    return page;
}

/**
 * Switch a page to a phone-sized touch viewport (iPhone 14-ish).
 * Call BEFORE login/navigation so the app loads in its mobile layout.
 */
export async function useMobileViewport(page) {
    await page.setViewport({
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
    });
    await page.setUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
}

export async function screenshot(page, name) {
    const dir = new URL('./screenshots/', import.meta.url).pathname;
    const { mkdirSync } = await import('fs');
    mkdirSync(dir, { recursive: true });
    const path = `${dir}${name}.png`;
    await page.screenshot({ path, fullPage: false });
    return path;
}
