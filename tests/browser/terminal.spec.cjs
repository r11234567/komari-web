const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }, testInfo) => {
  const events = [];
  page.on('console', message => events.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => events.push({ type: 'pageerror', text: error.stack }));
  page.on('requestfailed', request => events.push({ type: 'requestfailed', url: request.url(), failure: request.failure() }));
  testInfo._terminalEvents = events;
});
test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach('browser-console.json', {
    body: JSON.stringify(testInfo._terminalEvents, null, 2), contentType: 'application/json',
  });
  const observed = await page.evaluate(() => {
    const state = window.terminalAudit;
    return state ? { creates: state.creates, inputs: state.inputs, ready: state.ready } : null;
  }).catch(() => null);
  await testInfo.attach('synthetic-transport-observations.json', {
    body: JSON.stringify(observed, null, 2), contentType: 'application/json',
  });
});

for (const submit of ['button', 'Enter']) {
  test(`fresh 2FA confirmation starts the actual terminal session via ${submit}`, async ({ page }) => {
    await page.goto('/tests/browser/fixtures/terminal.html?twofa=1');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.terminalAudit.creates.length)).toBe(0);
    await dialog.getByPlaceholder('000000').fill('123456');
    if (submit === 'button') await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    else await dialog.getByPlaceholder('000000').press('Enter');
    await expect.poll(() => page.evaluate(() => window.terminalAudit.creates.length), {
      message: 'Confirming fresh 2FA must call createRemoteSession, not only close its dialog',
    }).toBe(1);
    await expect.poll(() => page.evaluate(() => window.terminalAudit.creates[0]?.twoFactorCode)).toBe('123456');
  });
}

test('rejected terminal OTP can be corrected without recreating the tab', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/terminal.html?twofa=1');
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('000000').fill('000000');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.terminalAudit.creates.length)).toBe(1);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await dialog.getByPlaceholder('000000').fill('123456');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.terminalAudit.creates.length)).toBe(2);
});

for (const status of [200, 404]) {
  test(`account gate handles verification HTTP ${status} without reusing OTP`, async ({ page }) => {
    await page.route('**/api/me', route => route.fulfill({ json: {
      logged_in: true, uuid: 'synthetic-user', username: 'synthetic-user',
      sso_id: '', sso_type: '', '2fa_enabled': true,
    } }));
    await page.route('**/api/admin/2fa/verify', route => {
      expect(route.request().headers()['x-2fa-code']).toBe('123456');
      return route.fulfill({ status, json: { message: status === 200 ? 'ok' : 'not found' } });
    });
    await page.goto('/tests/browser/fixtures/account.html');
    const gate = page.locator('.km-account-2fa-gate');
    await gate.getByPlaceholder('000000').fill('123456');
    await gate.getByRole('button', { name: 'Confirm', exact: true }).click();
    if (status === 404) {
      await expect(gate.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
      await expect(gate).toBeVisible();
      await expect(page.locator('.km-account-password-form')).toHaveCount(0);
    } else {
      await expect(gate).toHaveCount(0);
      await expect(page.locator('#password_2fa')).toHaveValue('');
    }
  });
}

test('actual xterm selection copies into the browser system clipboard', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/terminal.html?twofa=0');
  await expect.poll(() => page.evaluate(() => window.terminalAudit?.ready)).toBe(true);
  await page.evaluate(() => {
    const term = window.terminalAudit.api.terminal;
    term.select(0, 0, 16);
    term.focus();
  });
  await page.keyboard.press('Control+Shift+C');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Clipboard sample');
});

test('actual paste is sent once and Ctrl+C without selection remains an interrupt', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/terminal.html?twofa=0');
  await expect.poll(() => page.evaluate(() => window.terminalAudit.creates.length)).toBe(1);
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('line one\nline two');
    window.terminalAudit.api.terminal.focus();
  });
  await page.keyboard.press('Control+Shift+V');
  await expect.poll(() => page.evaluate(() => window.terminalAudit.inputs.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.terminalAudit.inputs[0]))
    .toEqual(Array.from(Buffer.from('line one\rline two')));
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => window.terminalAudit.inputs.at(-1))).toEqual([3]);
  await expect.poll(() => page.evaluate(() => window.terminalAudit.inputs.length)).toBe(2);
});
