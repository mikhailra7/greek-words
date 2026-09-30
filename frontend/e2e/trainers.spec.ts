import { expect, test } from '@playwright/test'
import {
  activateOnly,
  findWord,
  fullGreek,
  seedDictionary,
  setSlider,
  WORDS,
} from './helpers.ts'

test.beforeEach(async ({ request }, testInfo) => {
  const id = await seedDictionary(request, `Тренажёры ${testInfo.project.name} ${Date.now()}`)
  await activateOnly(request, id)
})

test('study: cards, arrow, finish screen', async ({ page }) => {
  await page.goto('/study')
  await page.getByLabel('Показывать только слово').uncheck()
  await page.getByLabel('Озвучивать слова').uncheck()
  await setSlider(page, 2)
  await page.getByRole('button', { name: 'Начать' }).click()

  await expect(page.getByText('1 / 2')).toBeVisible()
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await expect(page.getByText('Готово: 2 слова')).toBeVisible()

  // «Ещё раз» starts a fresh session from the first card.
  await page.getByRole('button', { name: 'Ещё раз' }).click()
  await expect(page.getByText('1 / 2')).toBeVisible()
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await page.getByRole('button', { name: 'В меню' }).click()
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible()
})

test('study: swipe right — next word, swipe left — previous', async ({ page }) => {
  await page.goto('/study')
  await page.getByLabel('Показывать только слово').uncheck()
  await page.getByLabel('Озвучивать слова').uncheck()
  await setSlider(page, 3)
  await page.getByRole('button', { name: 'Начать' }).click()

  const card = page.locator('article')
  const shown = async () => (await card.locator('p.text-xl').textContent())!.trim()
  const swipe = async (dx: number) => {
    const box = (await card.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 3
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx / 2, y, { steps: 4 })
    await page.mouse.move(x + dx, y, { steps: 4 })
    await page.mouse.up()
  }

  await expect(page.getByText('1 / 3')).toBeVisible()
  const first = await shown()
  await swipe(-150) // nothing before the first card: it springs back
  await page.waitForTimeout(400)
  await expect(page.getByText('1 / 3')).toBeVisible()
  expect(await shown()).toBe(first)

  await swipe(150)
  await expect(page.getByText('2 / 3')).toBeVisible()
  const second = await shown()
  expect(second).not.toBe(first)

  await swipe(-150)
  await expect(page.getByText('1 / 3')).toBeVisible()
  expect(await shown()).toBe(first) // the same word as before

  // Laptop keys do the same: → next, ← back.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('2 / 3')).toBeVisible()
  expect(await shown()).toBe(second)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('1 / 3')).toBeVisible()
})

test('translate RU→GR: right and wrong answers, score, mistakes', async ({ page }) => {
  await page.goto('/translate')
  await page.getByRole('radio', { name: /С русского/ }).click()
  await page.getByLabel('Hard-режим').uncheck()
  await page.getByLabel('Показывать правильный ответ сразу').check()
  await setSlider(page, 2)
  await page.getByRole('button', { name: 'Начать' }).click()

  // Question 1: answer correctly.
  const options = page.locator('ul li button')
  const prompt1 = (await page.locator('article p').last().textContent())!.trim()
  await options.filter({ hasText: fullGreek(findWord(prompt1)) }).click()
  await page.getByRole('button', { name: 'Верно! Далее' }).click()

  // Question 2: pick a wrong option.
  const prompt2 = (await page.locator('article p').last().textContent())!.trim()
  const right = fullGreek(findWord(prompt2))
  await expect(options).toHaveCount(4)
  const texts = (await options.allTextContents()).map((t) => t.replace(/^\d/, '').trim())
  const wrong = texts.find((t) => t !== right)!
  await options.filter({ hasText: wrong }).click()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()

  await expect(page.getByText('Правильно 1 из 2')).toBeVisible()
  await expect(page.getByText(`✓ ${right}`)).toBeVisible()

  await page.getByRole('button', { name: 'Ещё раз' }).click()
  await expect(page.getByText('1 / 2')).toBeVisible()
})

test('translate hard mode: look-alike options, RU→GR only', async ({ page }) => {
  await page.goto('/translate')
  await page.getByRole('radio', { name: /С греческого/ }).click()
  await expect(page.getByLabel('Hard-режим')).toHaveCount(0) // only for RU→GR
  await page.getByRole('radio', { name: /С русского/ }).click()
  await page.getByLabel('Hard-режим').check()
  await page.getByLabel('Показывать правильный ответ сразу').check()
  await setSlider(page, 1)
  await page.getByRole('button', { name: 'Начать' }).click()

  const w = findWord((await page.locator('article p').last().textContent())!.trim())
  const right = fullGreek(w)
  const options = page.locator('ul li button')
  await expect(options).toHaveCount(4)
  const texts = (await options.allTextContents()).map((t) => t.replace(/^\d/, '').trim())
  expect(texts.filter((t) => t === right)).toHaveLength(1)
  // All seed words are «το …» nouns: exactly one option has another article.
  expect(texts.filter((t) => !t.startsWith('το '))).toHaveLength(1)
  // The others are «το» + a near-copy of the word (same length ±1).
  for (const t of texts.filter((x) => x.startsWith('το ') && x !== right)) {
    expect(Math.abs(t.length - right.length)).toBeLessThanOrEqual(1)
  }
  await options.filter({ hasText: new RegExp(`^\\d?${right}$`) }).click()
  await page.getByRole('button', { name: 'Верно! Далее' }).click()
  await expect(page.getByText('Правильно 1 из 1')).toBeVisible()

  await page.getByRole('button', { name: 'В меню' }).click()
  await page.getByLabel('Hard-режим').uncheck() // shared admin settings: leave it off
  await page.waitForTimeout(700)
})

test('mix: one task of each kind, labelled, mistakes tagged', async ({ page }) => {
  await page.goto('/mix')
  await page.getByLabel('Показывать правильный ответ сразу').check()
  await setSlider(page, 3)
  await page.getByRole('button', { name: 'Начать' }).click()

  // 3 tasks = one of each kind, random order. Choice ones answered right, «Напиши» wrong.
  const seen: string[] = []
  const options = page.locator('ul li button')
  const input = page.getByLabel('Ответ по-гречески')
  for (let i = 1; i <= 3; i++) {
    await expect(page.getByText(`${i} / 3`)).toBeVisible()
    const hint = (await page
      .locator('p')
      .filter({ hasText: /^(Выберите|Напишите)/ })
      .textContent())!
    seen.push(hint)
    if (hint === 'Напишите по-гречески') {
      await input.fill('λάθος')
      await input.press('Enter')
      await expect(page.getByText('Ваш ответ')).toBeVisible()
      await input.press('Enter')
    } else if (hint === 'Выберите перевод на греческий') {
      const w = findWord((await page.locator('article p').last().textContent())!.trim())
      await options.filter({ hasText: fullGreek(w) }).click()
      await page.getByRole('button', { name: 'Верно! Далее' }).click()
    } else {
      const greek = (await page.locator('article p').last().textContent())!.trim()
      const w = WORDS.find((x) => fullGreek(x) === greek)!
      await options.filter({ hasText: w.translations_ru.join(', ') }).click()
      await page.getByRole('button', { name: 'Верно! Далее' }).click()
    }
  }
  expect(seen.sort()).toEqual([
    'Выберите перевод на греческий',
    'Выберите перевод на русский',
    'Напишите по-гречески',
  ])
  await expect(page.getByText('Правильно 2 из 3')).toBeVisible()
  await expect(page.locator('li > p.text-xs')).toHaveText('Напиши') // the mistake's tag
  await expect(page.getByText('✗ λάθος')).toBeVisible()
})

test('write: on-screen Greek keyboard on a laptop only', async ({ page }, testInfo) => {
  await page.goto('/write')
  await setSlider(page, 1)
  await page.getByRole('button', { name: 'Начать' }).click()
  const keyboard = page.getByRole('group', { name: 'Греческая клавиатура' })
  if (testInfo.project.name === 'phone') {
    await expect(keyboard).toBeHidden() // the phone's own keyboard is used
    return
  }
  const input = page.getByLabel('Ответ по-гречески')
  const key = (k: string) => keyboard.getByRole('button', { name: k, exact: true }).click()

  // «το νερό»: ΄ is a dead key — press it, then the (now accented) vowel. A typo fixed with ⌫.
  for (const k of ['τ', 'ο', 'Пробел', 'ν', 'ε', 'ρ', 'α', 'Стереть', 'Ударение', 'ό']) await key(k)
  await expect(input).toHaveValue('το νερό')
  await expect(input).toBeFocused() // clicks don't take the caret away

  // The caret position is respected: insert in the middle.
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 0))
  await key('α')
  await expect(input).toHaveValue('ατο νερό')
  await key('Стереть')

  await key('Диэресис')
  await key('ϊ') // keys show the marked letter while a dead key is on
  await expect(input).toHaveValue('ϊτο νερό')

  await input.press('Enter')
  await expect(keyboard).toBeHidden() // replaced by the verdict
})

test('write: «Не знаю» counts as wrong and shows the answer', async ({ page }) => {
  await page.goto('/write')
  await setSlider(page, 1)
  await page.getByRole('button', { name: 'Начать' }).click()
  const input = page.getByLabel('Ответ по-гречески')
  const w = findWord((await page.locator('article p').textContent())!.trim())

  await input.fill('κάτι') // a half-typed guess is dropped
  await page.getByRole('button', { name: 'Не знаю' }).click()
  await expect(page.getByText('не знаю', { exact: true })).toBeVisible()
  await expect(page.getByText('Правильно', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Не знаю' })).toBeHidden()
  await expect(input).toBeFocused() // the phone keyboard stays up

  await input.press('Enter')
  await expect(page.getByText('Правильно 0 из 1')).toBeVisible()
  await expect(page.getByText(`✓ ${fullGreek(w)}`)).toBeVisible()
  await expect(page.getByText('✗ не знаю')).toBeVisible()
})

test('write: strict accents, article required, capitals ok', async ({ page }) => {
  await page.goto('/write')
  await setSlider(page, 2)
  await page.getByRole('button', { name: 'Начать' }).click()
  const input = page.getByLabel('Ответ по-гречески')

  // Card 1: without the accent → wrong, with a hint.
  const w1 = findWord((await page.locator('article p').textContent())!.trim())
  await input.fill(fullGreek(w1).normalize('NFD').replace(/́/g, ''))
  await input.press('Enter')
  await expect(page.getByText('Почти: проверьте ударение')).toBeVisible()
  await input.press('Enter') // next

  // Card 2: in capitals → right.
  const w2 = findWord((await page.locator('article p').textContent())!.trim())
  await input.fill(fullGreek(w2).toUpperCase())
  await input.press('Enter')
  await expect(page.getByText('Верно!')).toBeVisible()
  await input.press('Enter')

  await expect(page.getByText('Правильно 1 из 2')).toBeVisible()

  await page.getByRole('button', { name: 'Ещё раз' }).click()
  await expect(page.getByText('1 / 2')).toBeVisible()
  await expect(page.getByLabel('Ответ по-гречески')).toHaveValue('')
})

test('study: «Озвучивать слова» is remembered and controls auto-play', async ({ page }) => {
  const autoPlayed: string[] = []
  await page.route(/\/api\/words\/\d+\/audio(\?|$)/, (route) => {
    if (route.request().resourceType() === 'media') autoPlayed.push(route.request().url())
    return route.fulfill({ status: 503, body: '{}' })
  })

  await page.goto('/study')
  await page.getByLabel('Показывать только слово').uncheck()
  const speak = page.getByLabel('Озвучивать слова')
  await speak.uncheck()
  await page.waitForTimeout(700) // settings are saved with a short debounce
  await page.reload()
  await expect(speak).not.toBeChecked() // stays off across sessions

  await setSlider(page, 1)
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.getByText('1 / 1')).toBeVisible()
  await page.waitForTimeout(1_500)
  expect(autoPlayed).toHaveLength(0) // no auto-play
  await page.getByRole('button', { name: 'Произнести ещё раз' }).click()
  await expect.poll(() => autoPlayed.length).toBeGreaterThan(0) // button still plays

  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await page.getByRole('button', { name: 'В меню' }).click()
  await speak.check()
  await page.waitForTimeout(700)
  await page.reload()
  await expect(speak).toBeChecked() // and stays on once switched back
})

test('study: «Показывать только слово» — word first, tap flips and speaks', async ({ page }) => {
  const audio: string[] = []
  await page.route(/\/api\/words\/\d+\/audio(\?|$)/, (route) => {
    if (route.request().resourceType() === 'media') audio.push(route.request().url())
    return route.fulfill({ status: 503, body: '{}' })
  })
  await page.goto('/study')
  await page.getByLabel('Озвучивать слова').check() // even with auto-play on…
  const wordOnly = page.getByLabel('Показывать только слово')
  await wordOnly.check()
  await page.waitForTimeout(700)
  await page.reload()
  await expect(wordOnly).toBeChecked() // remembered

  await setSlider(page, 2)
  await page.getByRole('button', { name: 'Начать' }).click()
  const front = page.locator('article [aria-hidden]').first()
  const back = page.locator('article [aria-hidden]').nth(1)
  await expect(front).toHaveAttribute('aria-hidden', 'false')
  await expect(back).toHaveAttribute('aria-hidden', 'true')
  await expect(front).toContainText('Нажмите, чтобы перевернуть')
  await page.waitForTimeout(1_500)
  expect(audio).toHaveLength(0) // …nothing plays on open

  await front.click()
  await expect(back).toHaveAttribute('aria-hidden', 'false')
  await expect.poll(() => audio.length).toBeGreaterThan(0) // the flip plays the word

  // Next card starts face down again, without sound.
  const played = audio.length
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect(page.locator('article [aria-hidden]').first()).toHaveAttribute(
    'aria-hidden',
    'false',
  )
  await page.waitForTimeout(1_000)
  expect(audio.length).toBe(played)

  // Leave the shared test user as it was («Закончить изучение?» → yes).
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Выйти' }).click()
  await wordOnly.uncheck()
  await page.waitForTimeout(700)
})
