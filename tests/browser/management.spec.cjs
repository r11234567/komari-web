const { test, expect } = require('@playwright/test');

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

  test(`token revocation and legacy shutdown need confirmation without 2FA (${language})`, async ({ page }) => {
    await page.goto(`/tests/browser/fixtures/management.html?screen=tokens&lng=${language}`);
    await page.getByRole('button', { name: zh ? '撤销' : 'Revoke', exact: true }).click();
    let confirmation = page.getByRole('alertdialog');
    await confirmation.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true }).click();
    expect(await page.evaluate(() => window.managementAudit.calls)).toEqual([]);
    await page.getByRole('button', { name: zh ? '撤销' : 'Revoke', exact: true }).click();
    await confirmation.getByRole('button', { name: zh ? '撤销' : 'Revoke', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.managementAudit.calls)).toEqual([{ action: 'revoke-token', proof: false }]);
    await page.getByRole('button', { name: zh ? '停用旧 Key' : 'Disable legacy key', exact: true }).click();
    confirmation = page.getByRole('alertdialog');
    await expect(confirmation.locator('input')).toHaveCount(0);
    await confirmation.getByRole('button', { name: zh ? '停用旧 Key' : 'Disable legacy key', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.managementAudit.calls)).toEqual([{ action: 'revoke-token', proof: false }, { action: 'disable-legacy', proof: false }]);
  });
}
