const { test } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const base = process.env.TEST_URL || "http://127.0.0.1:4173/";

test("native hash navigation, keyboard focus, interactions and responsive layouts", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, colorScheme] of [[320, "light"], [390, "dark"], [1280, "light"]]) {
      const page = await browser.newPage({ viewport: { width, height: 850 }, colorScheme });
      try {
        await page.goto(base, { waitUntil: "networkidle" });
        const accounts = page.locator('.progress-nav a[href="#accounts"]');
        const optimize = page.locator('.progress-nav a[href="#optimize"]');
        const review = page.locator('.progress-nav a[href="#review"]');
        assert.equal(await accounts.getAttribute("aria-current"), "location");
        assert.equal(await page.locator(".account-editor").count(), 3);

        // Native links create separate browser history entries.
        await optimize.click();
        await page.waitForURL("**/#optimize");
        assert.equal(await optimize.getAttribute("aria-current"), "location");
        assert.equal(await accounts.getAttribute("aria-current"), null);
        await review.click();
        await page.waitForURL("**/#review");
        assert.equal(await review.getAttribute("aria-current"), "location");
        await page.goBack();
        assert.equal(new URL(page.url()).hash, "#optimize");
        assert.equal(await optimize.getAttribute("aria-current"), "location");
        await page.reload();
        assert.equal(await optimize.getAttribute("aria-current"), "location");

        // Focus is visibly styled, and buttons retain their original calculations.
        await optimize.focus();
        assert.equal(await optimize.evaluate(el => document.activeElement === el), true);
        const outline = await optimize.evaluate(el => getComputedStyle(el).outlineStyle);
        assert.notEqual(outline, "none");
        await page.getByRole("button", { name: "Add account" }).click();
        assert.equal(await page.locator(".account-editor").count(), 4);
        await page.getByRole("button", { name: "Optimize placement" }).click();
        await page.waitForURL("**/#review");
        assert.equal(await review.getAttribute("aria-current"), "location");
        assert.match(await page.locator(".success-banner").innerText(), /Placement updated/);
        await page.getByRole("button", { name: "Reset inputs" }).click();
        assert.equal(await page.locator(".account-editor").count(), 3);

        const horizontalOverflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        assert.ok(horizontalOverflow <= 1, `Horizontal overflow ${horizontalOverflow}px at ${width}px (${colorScheme})`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
