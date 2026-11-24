const { test, expect } = require('@playwright/test');

test('CSV export explains a missing worker and enables the responsive form after refresh', async ({ page }, testInfo) => {
  const backendDiagnostic = 'strict background export worker unavailable; configure the isolated Linux worker with a verified CPU cap';
  let detected = false;
  let available = false;
  let failSubmission = false;
  await page.route('**/api/me', route => route.fulfill({ json: { logged_in: true, uuid: 'synthetic-operator' } }));
  await page.route('**/api/admin/history/export/retention', route => route.fulfill({ json: {
    status: 'success', data: { worker_detected: detected, worker_available: available, worker_error: backendDiagnostic, resource_hours: 720, ping_hours: 720 },
  } }));
  await page.route('**/api/admin/history/export', route => {
    if (route.request().method() === 'POST') {
      if (failSubmission) {
        available = false;
        return route.fulfill({ status: 503, json: { status: 'error', message: backendDiagnostic } });
      }
      return route.fulfill({ status: 202, json: { status: 'success', data: { id: 'created-export' } } });
    }
    return route.fulfill({ json: { status: 'success', data: [] } });
  });

  await page.setViewportSize({ width: 1280, height: 920 });
  await page.goto('/tests/browser/fixtures/management.html?screen=exports&lng=zh-CN');
  const card = page.getByTestId('history-export-card');
  const submit = card.getByTestId('create-background-export');
  const status = card.getByRole('status');
  const refresh = card.getByRole('button', { name: '刷新任务列表', exact: true });
  await expect(status).toHaveText('CSV 导出 Worker 未安装或未启动');
  await expect(card.getByRole('link', { name: '安装文档' })).toHaveAttribute('href', 'https://github.com/r11234567/komari/blob/main/docs/background-csv-worker.md');
  await expect(card).not.toContainText(backendDiagnostic);
  await expect(submit).toBeDisabled();
  await expect(card.getByRole('combobox').first()).toHaveText('Fixture node');
  const desktopSelects = await card.getByRole('combobox').evaluateAll(fields => fields.map(field => field.getBoundingClientRect().top));
  expect(new Set(desktopSelects).size).toBe(1);
  await page.locator('.km-setting-card').screenshot({ path: testInfo.outputPath('csv-export-desktop.png') });

  detected = true;
  await refresh.click();
  await expect(status).toHaveText('CSV 导出 Worker 暂不可用');
  await expect(submit).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 920 });
  const mobileSelects = await card.getByRole('combobox').evaluateAll(fields => fields.map(field => field.getBoundingClientRect().top));
  expect(mobileSelects[1]).toBeGreaterThan(mobileSelects[0]);
  expect(mobileSelects[2]).toBeGreaterThan(mobileSelects[1]);
  await card.getByRole('combobox').nth(2).click();
  await page.getByRole('option', { name: '图表汇总 CSV' }).click();
  const interval = card.getByRole('spinbutton', { name: '间隔（秒，0 为自动）' });
  await interval.fill('60');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('.km-setting-card').screenshot({ path: testInfo.outputPath('csv-export-mobile.png') });

  available = true;
  await refresh.click();
  await expect(status).toHaveCount(0);
  await expect(submit).toBeEnabled();
  const post = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/admin/history/export');
  await submit.click();
  expect((await post).postDataJSON()).toMatchObject({ uuid: 'synthetic-node', category: 'resource', mode: 'summary', aggregation: 'avg', interval_seconds: 60, hours: 24 });
  await expect(submit).toBeEnabled();

  failSubmission = true;
  await submit.click();
  await expect(status).toHaveText('CSV 导出 Worker 暂不可用');
  await expect(submit).toBeDisabled();
  await expect(card).not.toContainText(backendDiagnostic);
});

for (const language of ['zh-CN', 'en']) {
  const zh = language === 'zh-CN';
  test(`plugin history is compact, localized and revokes without 2FA (${language})`, async ({ page }, testInfo) => {
    await page.goto(`/tests/browser/fixtures/management.html?lng=${language}`);
    await page.getByRole('button', { name: zh ? '授权记录' : 'Approvals', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: zh ? '插件授权' : 'Plugin authorization', exact: true })).toHaveCount(1);
    await expect(dialog.getByText(zh ? '已授权' : 'Approved', { exact: true })).toHaveCount(2);
    await expect(dialog.getByText(/SHA-256:/).first()).not.toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds.width).toBeLessThanOrEqual(622);
    expect(bounds.height).toBeLessThan(600);
    await testInfo.attach(`plugin-dialog-${language}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    await dialog.locator('summary').first().click();
    await expect(dialog.getByText(zh ? '来源: 已有安装' : 'Source: Existing installation', { exact: true })).toBeVisible();
    if (zh) await expect(dialog.getByText('Existing installation snapshot', { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: zh ? '撤销授权' : 'Revoke authorization', exact: true }).first().click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toBeVisible();
    await expect(confirmation.locator('input')).toHaveCount(0);
    expect(await page.evaluate(() => window.managementAudit.calls)).toEqual([]);
    await confirmation.getByRole('button', { name: zh ? '撤销授权' : 'Revoke authorization', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.managementAudit.calls)).toEqual([{ action: 'revoke', proof: false }]);
    await expect(dialog.getByText(zh ? '已撤销' : 'Revoked', { exact: true })).toBeVisible();
  });

  test(`token revocation needs confirmation without 2FA (${language})`, async ({ page }) => {
    await page.goto(`/tests/browser/fixtures/management.html?screen=tokens&lng=${language}`);
    await page.getByRole('button', { name: zh ? '撤销' : 'Revoke', exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    await confirmation.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true }).click();
    expect(await page.evaluate(() => window.managementAudit.calls)).toEqual([]);
    await page.getByRole('button', { name: zh ? '撤销' : 'Revoke', exact: true }).click();
    await confirmation.getByRole('button', { name: zh ? '撤销' : 'Revoke', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.managementAudit.calls)).toEqual([{ action: 'revoke-token', proof: false }]);

  });
}
