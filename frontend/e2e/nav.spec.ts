import { expect, test } from '@playwright/test'

test('phone: ☰ menu opens, navigates, closes on Back and on backdrop', async ({ page }) => {
  await page.goto('/dictionaries')
  const menu = page.getByRole('dialog', { name: 'Меню' })
  await expect(menu).toHaveCount(0)
  await expect(page.locator('header')).toContainText('Словари')

  await page.getByRole('button', { name: 'Открыть меню' }).click()
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('link')).toHaveCount(7)
  await menu.getByRole('link', { name: 'Аудио повторение' }).click()
  await expect(page).toHaveURL(/\/listen$/)
  await expect(menu).toHaveCount(0)
  await expect(page.locator('header')).toContainText('Аудио')

  // Phone «Back» closes the menu and stays on the page.
  await page.getByRole('button', { name: 'Открыть меню' }).click()
  await expect(menu).toBeVisible()
  await page.goBack()
  await expect(menu).toHaveCount(0)
  await expect(page).toHaveURL(/\/listen$/)

  // Back again goes to the previous page (the menu left no extra history step).
  await page.goBack()
  await expect(page).toHaveURL(/\/dictionaries$/)

  // Tap outside closes it.
  await page.getByRole('button', { name: 'Открыть меню' }).click()
  await page.mouse.click(380, 400) // right of the 288-px panel, on the dimmed backdrop
  await expect(menu).toHaveCount(0)
  await expect(page).toHaveURL(/\/dictionaries$/)
})

test('laptop: all sections in one row on top, no ☰', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dictionaries')
  await expect(page.getByRole('button', { name: 'Открыть меню' })).toBeHidden()
  for (const name of ['Словари', 'Изучение', 'Переведи', 'Напиши', 'Микс', 'Аудио', 'Профиль']) {
    await expect(page.getByRole('navigation').getByRole('link', { name })).toBeVisible()
  }
})
