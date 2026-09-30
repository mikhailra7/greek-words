import { expect, test } from '@playwright/test'
import { activateOnly, seedDictionary } from './helpers.ts'

test('categories: create, label a word, train on a category across dictionaries', async ({
  page,
  request,
}) => {
  const stamp = Date.now()
  const d1 = await seedDictionary(request, `Кат-1 ${stamp}`, [
    { article: 'το', greek: 'νερό', translations_ru: ['вода'] },
    { article: 'το', greek: 'σπίτι', translations_ru: ['дом'] },
  ])
  const d2 = await seedDictionary(request, `Кат-2 ${stamp}`, [
    { article: 'το', greek: 'ψωμί', translations_ru: ['хлеб'] },
  ])
  await activateOnly(request, -1) // no dictionaries ticked

  // Create a category from the «Категории» tab.
  const name = `Еда ${stamp}`
  await page.goto('/dictionaries')
  await page.getByRole('tab', { name: 'Категории' }).click()
  await expect(page).toHaveURL(/tab=categories/)
  await page.getByRole('button', { name: '+ Новая категория' }).click()
  await page.getByLabel('Название').fill(name)
  await page.getByLabel('Эмодзи').fill('🍽️')
  await page.getByRole('button', { name: 'Создать' }).click()
  await expect(page.getByRole('heading', { name: `🍽️ ${name}` })).toBeVisible()
  await expect(page.getByText('Слов пока нет')).toBeVisible()

  // Put words from two dictionaries into it through the word form.
  for (const [d, greek] of [
    [d1, 'το νερό'],
    [d2, 'το ψωμί'],
  ] as const) {
    await page.goto(`/dictionaries/${d}`)
    await page.getByRole('button').filter({ hasText: greek }).click()
    await page.getByLabel('Категория').selectOption({ label: `🍽️ ${name}` })
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  await page.goto(`/dictionaries/${d1}`)
  await expect(page.getByText(`🍽️ ${name}`)).toBeVisible() // label under the word

  // The category page lists them with their dictionaries; tick it for training.
  await page.goto('/dictionaries?tab=categories')
  await page.getByRole('link', { name: new RegExp(name) }).click()
  await expect(page.getByText(`Кат-1 ${stamp}`)).toBeVisible()
  await expect(page.getByText(`Кат-2 ${stamp}`)).toBeVisible()
  await expect(page.getByText('2 слова из всех словарей')).toBeVisible()
  await page.getByLabel('Использовать в тренировках').check()

  await page.goto('/dictionaries')
  await expect(page.getByText(/В тренировке: 2 слова \(категорий: 1\)/)).toBeVisible()

  // Training pulls exactly those two words.
  await page.goto('/study')
  await expect(page.locator('input[type=range]')).toHaveAttribute('max', '2')

  // Clean up for other tests: untick the category.
  await page.goto('/dictionaries?tab=categories')
  await page.getByLabel(`Использовать категорию «${name}» в тренировках`).uncheck()
  await expect(page.getByText(/Отметьте словари или категории/)).toBeVisible()
})

test('quick labelling: «Без категории: N» → pick per row, create one on the fly', async ({
  page,
  request,
}) => {
  const stamp = Date.now()
  const cat = await (
    await request.post('/api/categories', { data: { name: `Быстрая ${stamp}` } })
  ).json()
  const d = await seedDictionary(request, `Разметка ${stamp}`, [
    { article: 'το', greek: `λέξη${stamp}`, translations_ru: ['слово'] },
    { article: 'το', greek: `βιβλίο${stamp}`, translations_ru: ['книга'] },
    { article: 'το', greek: `μολύβι${stamp}`, translations_ru: ['карандаш'] },
  ])
  await page.goto(`/dictionaries/${d}`)
  await page.getByRole('button', { name: 'Без категории: 3' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Без категории: 3')).toBeVisible()

  await sheet.getByLabel(`Категория для το λέξη${stamp}`).selectOption(String(cat.id))
  await expect(sheet.getByText('Без категории: 2')).toBeVisible()

  // A new category right from the picker.
  page.once('dialog', (dlg) => dlg.accept(`Школа ${stamp}`))
  await sheet.getByLabel(`Категория для το βιβλίο${stamp}`).selectOption('new')
  await expect(sheet.getByText('Без категории: 1')).toBeVisible()

  await sheet.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByRole('button', { name: 'Без категории: 1' })).toBeVisible()
  await expect(page.getByText(`Школа ${stamp}`)).toBeVisible() // label under the word
  await expect(page.getByText(`Быстрая ${stamp}`)).toBeVisible()
})
