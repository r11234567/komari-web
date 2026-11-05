const { test, expect } = require('@playwright/test');

test('production WatchSession adapter resumes the same session/cursor after browser network error', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/transport.html');
  const received = await page.evaluate(() => window.adapterAudit.watch());
  expect(received).toEqual(['1', 'reconnecting', '2']);
  expect(await page.evaluate(() => window.adapterAudit.state.watches)).toEqual(['0', '1']);
});

test('ambiguous input retries the original sequence and identical bytes', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/transport.html');
  await page.evaluate(() => window.adapterAudit.send());
  const commands = await page.evaluate(() => window.adapterAudit.state.commands);
  expect(commands).toHaveLength(2);
  expect(commands[0]).toEqual({ sequence: '7', bytes: Array.from(Buffer.from('once\n')) });
  expect(commands[1]).toEqual(commands[0]);
});

test('permission denial is terminal and locking during retry prevents another command', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/transport.html');
  const denied = await page.evaluate(async () => {
    window.adapterAudit.deny();
    try { await window.adapterAudit.send(); return false; } catch { return true; }
  });
  expect(denied).toBe(true);
  expect(await page.evaluate(() => window.adapterAudit.state.commands)).toHaveLength(1);
  await page.reload();
  const stopped = await page.evaluate(async () => {
    const result = window.adapterAudit.send().then(() => false, () => true);
    setTimeout(() => window.adapterAudit.lock(), 50);
    return result;
  });
  expect(stopped).toBe(true);
  expect(await page.evaluate(() => window.adapterAudit.state.commands)).toHaveLength(1);
});
