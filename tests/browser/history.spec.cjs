const { test, expect } = require('@playwright/test');

test('production chart aborts hidden reads and drops queued summaries before resuming', async ({ page }) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/tests/browser/fixtures/history.html');
  await expect.poll(() => page.evaluate(() => window.historyAudit?.state.queries)).toBe(1);
  await page.evaluate(() => window.historyAudit.visible(false));
  await expect.poll(() => page.evaluate(() => window.historyAudit.state.aborted)).toBe(1);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.historyAudit.state)).toEqual({ queries: 1, summaries: 0, aborted: 1 });
  await page.evaluate(() => window.historyAudit.visible(true));
  await expect.poll(() => page.evaluate(() => window.historyAudit.state)).toEqual({ queries: 2, summaries: 1, aborted: 1 });
  expect(failures).toEqual([]);
});
