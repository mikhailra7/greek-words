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

test('«Повторить выученные слова»: the known words of all dictionaries, in every exercise', async ({
  browser,
  request,
}) => {
  const stamp = Date.now()
  const a = await seedDictionary(request, `Активный ${stamp}`, [
    { article: 'το', greek: 'νερό', translations_ru: ['вода'] },
    { article: 'το', greek: 'ψωμί', translations_ru: ['хлеб'] },
  ])
  const b = await seedDictionary(request, `Не отмечен ${stamp}`, [
    { article: 'το', greek: 'γάλα', translations_ru: ['молоко'] },
    { article: 'το', greek: 'τυρί', translations_ru: ['сыр'] },
  ])
  // Its own member: «known» marks are per user and other tests set the admin's.
  const invite = await (await request.post('/api/admin/invites', { data: {} })).json()
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const api = ctx.request
  expect(
    (
      await api.post('/api/auth/register', {
        data: { username: `repeat_${stamp}`, password: 'repeat-pass', invite_code: invite.code },
      })
    ).ok(),
  ).toBeTruthy()
  const ids = async (d: number) =>
    Object.fromEntries(
      (
        (await (await api.get(`/api/dictionaries/${d}`)).json()).words as {
          id: number
          greek: string
        }[]
      ).map((w) => [w.greek, w.id]),
    )
  const [wa, wb] = [await ids(a), await ids(b)]
  await api.put(`/api/dictionaries/${a}/active`, { data: { active: true } })
  await api.put(`/api/words/${wa['ψωμί']}/known`, { data: { known: true } })
  await api.put(`/api/words/${wb['γάλα']}/known`, { data: { known: true } }) // B isn't active

  const page = await ctx.newPage()
  await page.goto('/study')
  const repeat = page.getByLabel('Повторить выученные слова')
  await expect(page.getByText('из всех словарей (2)')).toBeVisible()
  await repeat.check()
  await expect(page.getByText('из всех словарей: 2')).toBeVisible()
  await expect(page.getByLabel('Скрыть выученные слова')).toHaveCount(0)
  await page.getByLabel('Показывать только слово').uncheck()
  await page.getByLabel('Озвучивать слова').uncheck()
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.getByText('1 / 2')).toBeVisible()
  const seen = [await page.locator('article p.text-3xl').textContent()]
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible() // the next card is in
  seen.push(await page.locator('article p.text-3xl').textContent())
  expect(seen.sort()).toEqual(['το γάλα', 'το ψωμί']) // the known ones, B's too

  // No active dictionaries at all: the toggle is still there, and it's enough to start.
  await api.put(`/api/dictionaries/${a}/active`, { data: { active: false } })
  await page.goto('/write') // each exercise remembers its own settings: off here
  await expect(page.getByText('В тренировке пока нет слов.')).toBeVisible()
  await repeat.check()
  await expect(page.getByText('из всех словарей: 2')).toBeVisible()
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.getByText('1 / 2')).toBeVisible()
  await ctx.close()
})
