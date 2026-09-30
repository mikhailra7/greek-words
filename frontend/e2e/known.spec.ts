import { expect, test, type Page } from '@playwright/test'
import { activateOnly, seedDictionary } from './helpers.ts'

const sliderMax = (page: Page) => page.locator('input[type=range]').first().getAttribute('max')

test('«Я знаю это слово»: hides words everywhere, slider follows, reset brings them back', async ({
  page,
  request,
}) => {
  const stamp = Date.now()
  const food = await (
    await request.post('/api/categories', { data: { name: `Знаю ${stamp}` } })
  ).json()
  const d = await seedDictionary(request, `Выученные ${stamp}`, [
    { article: 'το', greek: `ένα${stamp}`, translations_ru: ['один'] },
    { article: 'το', greek: `δύο${stamp}`, translations_ru: ['два'] },
    { article: 'το', greek: `τρία${stamp}`, translations_ru: ['три'] },
  ])
  const { words } = await (await request.get(`/api/dictionaries/${d}`)).json()
  await request.patch(`/api/words/${words[2].id}/category`, { data: { category_id: food.id } })
  await activateOnly(request, d)

  // Mark the first card as known right in «Изучение».
  await page.goto('/study')
  await expect(page.getByLabel('Скрыть выученные слова')).toBeChecked() // on by default
  expect(await sliderMax(page)).toBe('3')
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.getByLabel('Я знаю это слово').check()
  page.once('dialog', (dlg) => dlg.accept())
  await page.getByRole('button', { name: 'Выйти' }).click()

  // Every exercise now offers 2 words; switching the hiding off gives 3 again.
  for (const path of ['/study', '/translate', '/write', '/listen']) {
    await page.goto(path)
    await expect(page.getByText('Выучено: 1 слово — они не попадут в упражнение')).toBeVisible()
    expect(await sliderMax(page), path).toBe('2')
  }
  await page.goto('/write')
  await page.getByLabel('Скрыть выученные слова').uncheck()
  expect(await sliderMax(page)).toBe('3')
  await page.getByLabel('Скрыть выученные слова').check()

  // The dictionary shows the tick; reset clears it.
  await page.goto(`/dictionaries/${d}`)
  await expect(page.getByLabel(/Я знаю это слово:/).first()).toBeVisible()
  const checked = await page
    .getByLabel(/Я знаю это слово:/)
    .evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).checked).length)
  expect(checked).toBe(1)
  page.once('dialog', (dlg) => dlg.accept())
  await page.getByRole('button', { name: 'Сбросить выученные (1)' }).click()
  await expect(page.getByRole('button', { name: /Сбросить выученные/ })).toHaveCount(0)
  await page.goto('/study')
  expect(await sliderMax(page)).toBe('3')

  // Mark from the category page → gone from exercises; category reset brings it back.
  await page.goto(`/categories/${food.id}`)
  await page.getByLabel(`Я знаю это слово: το τρία${stamp}`).check()
  await page.goto('/listen')
  expect(await sliderMax(page)).toBe('2')
  await page.goto(`/categories/${food.id}`)
  page.once('dialog', (dlg) => dlg.accept())
  await page.getByRole('button', { name: 'Сбросить выученные (1)' }).click()
  await page.goto('/listen')
  expect(await sliderMax(page)).toBe('3')
})

test('all words known: start is blocked with a hint until hiding is off', async ({
  page,
  request,
}) => {
  const d = await seedDictionary(request, `Все знаю ${Date.now()}`, [
    { article: 'το', greek: `μόνο${Date.now()}`, translations_ru: ['только'] },
  ])
  await activateOnly(request, d)
  const { words } = await (await request.get(`/api/dictionaries/${d}`)).json()
  await request.put(`/api/words/${words[0].id}/known`, { data: { known: true } })

  await page.goto('/translate')
  await expect(page.getByText('Все слова отмечены как выученные')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Начать' })).toBeDisabled()
  await page.getByLabel('Скрыть выученные слова').uncheck()
  await expect(page.getByRole('button', { name: 'Начать' })).toBeEnabled()
  await page.getByLabel('Скрыть выученные слова').check() // leave settings as they were
  await page.waitForTimeout(700)
  await request.post(`/api/dictionaries/${d}/known/reset`)
})
