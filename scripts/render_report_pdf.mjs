import process from "node:process";
import { chromium } from "playwright";

function boundedEnvironmentInteger(name, fallback, minimum, maximum) {
    const rawValue = process.env[name];
    if (!rawValue || !/^\d+$/.test(rawValue)) return fallback;
    const parsedValue = Number(rawValue);
    if (!Number.isSafeInteger(parsedValue)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsedValue));
}

const MAX_INPUT_BYTES = boundedEnvironmentInteger(
    "REPORT_PDF_MAX_INPUT_BYTES",
    15 * 1024 * 1024,
    1024 * 1024,
    50 * 1024 * 1024
);
const WATCHDOG_MS = boundedEnvironmentInteger(
    "REPORT_PDF_WATCHDOG_MS",
    35_000,
    10_000,
    150_000
);
const CONTENT_TIMEOUT_MS = boundedEnvironmentInteger(
    "REPORT_PDF_CONTENT_TIMEOUT_MS",
    15_000,
    5_000,
    60_000
);
let browser;
async function closeBrowserWithin(timeoutMs = 3_000) {
    if (!browser) return;
    const currentBrowser = browser;
    browser = undefined;
    let timeoutId;
    await Promise.race([
        currentBrowser.close().catch(() => {}),
        new Promise((resolve) => {
            timeoutId = setTimeout(resolve, timeoutMs);
        })
    ]);
    if (timeoutId) clearTimeout(timeoutId);
}

const watchdog = setTimeout(async () => {
    process.stderr.write("PDF rendering timed out.");
    try {
        await closeBrowserWithin();
    } finally {
        process.exit(1);
    }
}, WATCHDOG_MS);

try {
    const chunks = [];
    let inputBytes = 0;
    for await (const chunk of process.stdin) {
        inputBytes += chunk.length;
        if (inputBytes > MAX_INPUT_BYTES) {
            throw new Error("PDF input exceeds the safe size limit.");
        }
        chunks.push(chunk);
    }
    const html = Buffer.concat(chunks).toString("utf8");
    browser = await chromium.launch({
        headless: true,
        args: ["--disable-dev-shm-usage"]
    });
    const context = await browser.newContext({
        javaScriptEnabled: false,
        serviceWorkers: "block"
    });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
        const url = route.request().url();
        if (url === "about:blank" || url.startsWith("data:")) {
            await route.continue();
            return;
        }
        await route.abort("blockedbyclient");
    });
    await page.setContent(html, { waitUntil: "load", timeout: CONTENT_TIMEOUT_MS });
    await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
    });
    const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" }
    });
    process.stdout.write(pdf);
} catch (error) {
    process.stderr.write(String(error?.stack || error));
    process.exitCode = 1;
} finally {
    clearTimeout(watchdog);
    await closeBrowserWithin();
}
