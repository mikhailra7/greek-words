import { expect, test } from '@playwright/test'
import { ADMIN } from './global-setup.ts'

test('admin invites a member; member signs up with the code and has no admin tools', async ({
  page,
  browser,
}) => {
  await page.goto('/admin')
  await page.getByRole('button', { name: 'Создать код' }).click()
  const code = (await page.locator('.font-mono').first().textContent())!.trim()
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)

  const member = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const m = await member.newPage()
  await m.goto('/register')
  await m.locator('input[autocomplete=username]').fill('e2e_member')
  await m.locator('input[autocomplete=new-password]').nth(0).fill('member-pass')
  await m.locator('input[autocomplete=new-password]').nth(1).fill('member-pass')

  await m.getByLabel('Код приглашения').fill('WRNG-CODE')
  await m.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await expect(m.getByRole('alert')).toContainText('Неверный')

  await m.getByLabel('Код приглашения').fill(code.toLowerCase())
  await m.getByRole('button', { name: 'Зарегистрироваться' }).click()
  // The start page is the menu of modes.
  await expect(m).toHaveURL(/\/$/)
  await expect(m.getByRole('heading', { name: 'Что делаем?' })).toBeVisible()
  await m.goto('/dictionaries')
  await expect(m.getByRole('button', { name: 'Импорт из учебника' })).toHaveCount(0)

  await m.goto('/profile')
  await expect(m.getByText('Участник')).toBeVisible()
  await expect(m.getByText('Администрирование')).toHaveCount(0)
  await m.getByRole('button', { name: 'Выйти' }).click()
  await expect(m).toHaveURL(/\/login$/)
  await member.close()

  // The admin sees the new member in the list.
  await page.reload()
  await expect(page.getByText('e2e_member')).toBeVisible()
})

test('wrong password is rejected, right one signs in', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await ctx.newPage()
  await page.goto('/dictionaries')
  await expect(page).toHaveURL(/\/login$/)
  await page.locator('input[autocomplete=username]').fill(ADMIN.username)
  const password = page.locator('input[autocomplete=current-password]')
  await password.fill('nope-nope')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('alert')).toContainText('Неверное имя или пароль')
  await password.fill(ADMIN.password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/$/) // the start page (menu of modes)
  await ctx.close()
})
