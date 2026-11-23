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
        // Balance fields have no native border/outline; their enclosing label must
        // supply a visible focus ring for Tab and screen-magnifier users.
        const balanceField = page.getByRole("textbox", { name: /Balance for BPI/ });
        await balanceField.focus();
        const labelRing = await balanceField.evaluate(el => ({
          focused: document.activeElement === el,
          outline: getComputedStyle(el.closest(".money-input")).outlineStyle,
          width: getComputedStyle(el.closest(".money-input")).outlineWidth,
        }));
        assert.equal(labelRing.focused, true);
        assert.equal(labelRing.outline, "solid", "Balance field label must retain a visible focus ring");
        assert.equal(labelRing.width, "3px");
        // Two additions at the same clock tick must remain independently editable.
        // Legacy Date.now() IDs could collide and deleting one removed both.
        await page.evaluate(() => { Date.now = () => 1700000000000; });
        await page.getByRole("button", { name: "Add account" }).click();
        await page.getByRole("button", { name: "Add account" }).click();
        assert.equal(await page.locator(".account-editor").count(), 5);
        await page.getByRole("button", { name: "Remove New account" }).first().click();
        assert.equal(await page.locator(".account-editor").count(), 4,
          "Removing one new account must preserve the other despite identical clock ticks");
        assert.equal(await page.getByRole("button", { name: "Remove New account" }).count(), 1);
        await page.getByRole("button", { name: "Optimize placement" }).click();
        await page.waitForURL("**/#review");
        assert.equal(await review.getAttribute("aria-current"), "location");
        assert.match(await page.locator(".success-banner").innerText(), /Placement updated/);
        assert.equal(await page.locator(".success-banner").getAttribute("role"), "status");
        assert.equal(await page.locator("#review").getAttribute("aria-labelledby"), "review-heading");
        assert.equal(await page.locator("#review").evaluate(el => document.activeElement === el), true,
          "Keyboard focus should move to the labelled review results after optimization");
        // A changed tax assumption must not leave a stale "Placement updated" notice.
        // HTML min/max attributes are hints only; React must bound the actual model.
        const taxInputs = page.locator('.percent-control input[type="number"]');
        await taxInputs.nth(0).fill("125");
        assert.equal(await taxInputs.nth(0).inputValue(), "60");
        assert.equal(await page.locator(".success-banner").count(), 0);
        await taxInputs.nth(1).fill("-12");
        assert.equal(await taxInputs.nth(1).inputValue(), "0");
        await page.getByRole("button", { name: /Return.*yield assumptions/ }).click();
        const yields = page.locator('.assumptions-panel input[type="number"]');
        await yields.nth(0).fill("99");
        await yields.nth(1).fill("-3");
        assert.deepEqual(await yields.evaluateAll(elements => elements.map(el => el.value)), ["20", "0"]);
        assert.equal(await page.locator(".account-editor").count(), 4,
          "Changing assumptions must not discard accounts or balances");
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
