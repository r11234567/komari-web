const { expect, test } = require('@playwright/test');

test('the live footer preserves text and a same-origin link while removing active markup', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/footer.html');
  const footer = page.locator('.km-footer');
  await expect(footer.locator('strong')).toHaveText('Local footer');
  await expect(footer.locator('strong')).not.toHaveAttribute('style');
  const link = footer.getByRole('link', { name: 'About' });
  await expect(link).toHaveAttribute('href', '/about');
  await expect(link).not.toHaveAttribute('onclick');
  await expect(footer.locator('form, input, svg')).toHaveCount(0);
});
