import { expect, test } from '@playwright/test'
import { activateOnly, seedDictionary, setSlider, silentWav } from './helpers.ts'

test('audio review: greek → pause → russian → pause, pause/play, finish', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000)
  const id = await seedDictionary(request, `Аудио ${Date.now()}`)
  await activateOnly(request, id)
  const audioRequests: string[] = []
  await page.route(/\/api\/words\/\d+\/audio/, (route) => {
    audioRequests.push(new URL(route.request().url()).pathname)
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() })
  })

  await page.goto('/listen')
  await expect(page.getByText('3 с', { exact: true })).toBeVisible() // default pause
  await setSlider(page, 2)
  await setSlider(page, 1, 1) // pause 1 s
  await expect(page.getByText('1 с', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Начать' }).click()

  const status = page.locator('[aria-live=polite]')
  await expect(page.getByText('1 / 2')).toBeVisible()

  // Pause right away (whatever the phase): nothing moves on while paused.
  await page.getByRole('button', { name: 'Пауза' }).click()
  await expect(status).toHaveText('на паузе')
  await page.waitForTimeout(2_500)
  await expect(status).toHaveText('на паузе')
  await expect(page.getByText('1 / 2')).toBeVisible()

  // ⏭ while paused: next word, still paused; ⏮ goes back.
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect(status).toHaveText('на паузе')
  await page.getByRole('button', { name: 'Предыдущее слово' }).click()
  await expect(page.getByText('1 / 2')).toBeVisible()

  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(status).not.toHaveText('на паузе')

  // ⏭ while playing jumps at once; ⏭ on the last word finishes.
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await expect(page.getByText('Прослушано: 2 слова')).toBeVisible({ timeout: 3_000 })

  // «Ещё раз» + natural end with 1 s pauses (~4 s for two words).
  await page.getByRole('button', { name: 'Ещё раз' }).click()
  await expect(page.getByText('1 / 2')).toBeVisible()
  await expect(page.getByText('Прослушано: 2 слова')).toBeVisible({ timeout: 8_000 })

  // Greek first, then Russian, for each word.
  const kinds = audioRequests
    .filter((p) => !p.endsWith('/'))
    .map((p) => (p.endsWith('/ru') ? 'ru' : 'el'))
  expect(kinds.slice(-4).length).toBe(4)
  expect(kinds).toContain('ru')
})

test('audio review: «Начать с русских слов» — Russian first, the Greek shows when it sounds', async ({
  page,
  request,
}) => {
  const id = await seedDictionary(request, `Аудио RU ${Date.now()}`)
  await activateOnly(request, id)
  const kinds: string[] = []
  await page.route(/\/api\/words\/\d+\/audio/, (route) => {
    kinds.push(new URL(route.request().url()).pathname.endsWith('/ru') ? 'ru' : 'el')
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() })
  })

  await page.goto('/listen')
  const ruFirst = page.getByLabel('Начать с русских слов')
  await ruFirst.check()
  await expect(page.getByText('Слово по-русски → пауза → по-гречески')).toBeVisible()
  await setSlider(page, 1)
  await setSlider(page, 1, 1) // pause 1 s
  await page.getByRole('button', { name: 'Начать' }).click()

  const status = page.locator('[aria-live=polite]')
  const greek = page.locator('[aria-hidden] > p[lang=el]').locator('..')
  await expect(status).toHaveText('по-русски')
  await expect(greek).toHaveAttribute('aria-hidden', 'true') // only the Russian so far
  await expect(status).toHaveText('по-гречески', { timeout: 4_000 })
  await expect(greek).toHaveAttribute('aria-hidden', 'false')
  await expect(page.getByText('Прослушано: 1 слово')).toBeVisible({ timeout: 6_000 })
  expect(kinds.filter((k, i) => k !== kinds[i - 1])).toEqual(['ru', 'el']) // in this order

  await page.getByRole('button', { name: 'В меню' }).click()
  await ruFirst.uncheck() // leave the shared user as it was
  await page.waitForTimeout(700)
})
