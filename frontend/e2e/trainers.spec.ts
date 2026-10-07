import { expect, test } from '@playwright/test'
import { activateOnly, findWord, fullGreek, seedDictionary, setSlider, WORDS } from './helpers.ts'

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

test('study: swipe left — next word, swipe right — previous; ← button', async ({ page }) => {
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
  const back = page.getByRole('button', { name: 'Предыдущее слово' })
  await expect(back).toBeDisabled() // nothing before the first card
  await swipe(150) // …and a swipe back just springs back
  await page.waitForTimeout(400)
  await expect(page.getByText('1 / 3')).toBeVisible()
  expect(await shown()).toBe(first)

  await swipe(-150)
  await expect(page.getByText('2 / 3')).toBeVisible()
  const second = await shown()
  expect(second).not.toBe(first)

  await swipe(150)
  await expect(page.getByText('1 / 3')).toBeVisible()
  expect(await shown()).toBe(first) // the same word as before

  // The ← button on the card goes back too.
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await expect(page.getByText('2 / 3')).toBeVisible()
  await expect(back).toBeEnabled()
  await back.click()
  await expect(page.getByText('1 / 3')).toBeVisible()
  expect(await shown()).toBe(first)

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
  // All seed words are «το …» nouns.
  // A random mix of mistakes now: 0–2 of the options may have another article (ο / η).
  expect(texts.filter((t) => !t.startsWith('το ')).length).toBeLessThanOrEqual(2)
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
  const screenKeyboard = page.getByLabel('Экранная клавиатура')
  await screenKeyboard.check()
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
      // «Экранная клавиатура»: the site keyboard, the device one stays closed.
      await expect(page.getByRole('group', { name: 'Греческая клавиатура' })).toBeVisible()
      await expect(input).toHaveAttribute('inputmode', 'none')
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

  await page.getByRole('button', { name: 'В меню' }).click()
  await screenKeyboard.uncheck() // leave the shared user as it was
  await page.waitForTimeout(700) // saved with a short debounce
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

test('«Воспроизвести ответ»: the Greek word plays when the answer is shown', async ({ page }) => {
  const audio: string[] = []
  await page.route(/\/api\/words\/\d+\/audio(\?|$)/, (route) => {
    if (route.request().resourceType() === 'media') audio.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' })
  })

  // «Переведи»: only offered while the right answer is shown.
  await page.goto('/translate')
  await page.getByRole('radio', { name: /С русского/ }).click()
  await page.getByLabel('Hard-режим').uncheck()
  await page.getByLabel('Показывать правильный ответ сразу').uncheck()
  await expect(page.getByLabel('Воспроизвести ответ')).toHaveCount(0)
  await page.getByLabel('Показывать правильный ответ сразу').check()
  await page.getByLabel('Воспроизвести ответ').check()
  await setSlider(page, 1)
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.waitForTimeout(800)
  expect(audio).toHaveLength(0) // nothing before the answer
  await page.locator('ul li button').first().click()
  await expect.poll(() => audio.length).toBe(1)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'В меню' }).click()
  await page.getByLabel('Воспроизвести ответ').uncheck() // leave the shared user as it was

  // «Напиши»: after the check, right or wrong.
  await page.goto('/write')
  await page.getByLabel('Воспроизвести ответ').check()
  await setSlider(page, 1)
  await page.getByRole('button', { name: 'Начать' }).click()
  const before = audio.length
  await page.getByRole('button', { name: 'Не знаю' }).click()
  await expect(page.getByText('Ваш ответ')).toBeVisible()
  await expect.poll(() => audio.length).toBe(before + 1)
  await page.getByLabel('Ответ по-гречески').press('Enter')
  await page.getByRole('button', { name: 'В меню' }).click()
  await page.getByLabel('Воспроизвести ответ').uncheck()
  await page.waitForTimeout(700) // saved with a short debounce
})

test('write: «Экранная клавиатура» — the site keyboard on a phone, the device one stays closed', async ({
  page,
}) => {
  await page.goto('/write')
  const setting = page.getByLabel('Экранная клавиатура')
  await setting.check()
  await setSlider(page, 1)
  await page.getByRole('button', { name: 'Начать' }).click()

  const keyboard = page.getByRole('group', { name: 'Греческая клавиатура' })
  await expect(keyboard).toBeVisible() // on the phone project too
  const input = page.getByLabel('Ответ по-гречески')
  await expect(input).toHaveAttribute('inputmode', 'none') // the device keyboard never opens

  // Type the answer with the site keys: an accented vowel = ΄, then the vowel.
  const word = fullGreek(findWord((await page.locator('article p').textContent())!.trim()))
  const accented: Record<string, string> = {
    ά: 'α',
    έ: 'ε',
    ή: 'η',
    ί: 'ι',
    ό: 'ο',
    ύ: 'υ',
    ώ: 'ω',
  }
  for (const ch of word) {
    if (ch === ' ') await keyboard.getByRole('button', { name: 'Пробел' }).click()
    else {
      if (accented[ch]) await keyboard.getByRole('button', { name: 'Ударение' }).click()
      await keyboard.getByRole('button', { name: ch, exact: true }).click()
    }
  }
  await expect(input).toHaveValue(word)
  await expect(input).toBeFocused()
  await page.getByRole('button', { name: 'Проверить' }).click()
  await expect(page.getByText('Верно!')).toBeVisible()

  await input.press('Enter')
  await page.getByRole('button', { name: 'В меню' }).click()
  await setting.uncheck() // leave the shared user as it was
  await page.waitForTimeout(700) // saved with a short debounce
})

test('«Порядок по словарю»: «Изучение» goes as in the dictionary; «Аудио» asks for it too', async ({
  page,
}) => {
  await page.goto('/study')
  await page.getByLabel('Показывать только слово').uncheck()
  await page.getByLabel('Озвучивать слова').uncheck()
  const inOrder = page.getByLabel('Порядок по словарю')
  await inOrder.check()
  await expect(page.getByText('Как в словаре: словари — в порядке списка')).toBeVisible()
  await setSlider(page, WORDS.length)
  await page.getByRole('button', { name: 'Начать' }).click()
  const seen: string[] = []
  for (let i = 1; i <= WORDS.length; i++) {
    await expect(page.getByText(`${i} / ${WORDS.length}`)).toBeVisible()
    seen.push((await page.locator('article p.text-3xl').textContent())!.trim())
    await page.getByRole('button', { name: 'Следующее слово' }).click()
  }
  expect(seen).toEqual(WORDS.map(fullGreek)) // the seeded order
  await page.getByRole('button', { name: 'В меню' }).click()
  await inOrder.uncheck() // leave the shared user as it was

  await page.goto('/listen')
  const listenOrder = page.getByLabel('Порядок по словарю')
  await listenOrder.check()
  const asked = page.waitForRequest(/\/api\/training\/words\?.*in_order=true/)
  await page.getByRole('button', { name: 'Начать' }).click()
  await asked
  page.once('dialog', (d) => d.accept()) // «Закончить?»
  await page.getByRole('button', { name: 'Выйти' }).click()
  await listenOrder.uncheck()
  await page.waitForTimeout(700)
})

test('write: «Добивать до правильного ответа» — rounds until every word is right', async ({
  page,
}) => {
  await page.goto('/write')
  const untilRight = page.getByLabel('Добивать до правильного ответа')
  await untilRight.check()
  await setSlider(page, 2)
  await page.getByRole('button', { name: 'Начать' }).click()
  const input = page.getByLabel('Ответ по-гречески')
  const prompt = async () => findWord((await page.locator('article p').textContent())!.trim())

  // Round 1: a mistake shows the usual verdict, with the right spelling.
  await expect(page.getByText('1 / 2')).toBeVisible()
  const first = await prompt()
  await input.fill('λάθος')
  await input.press('Enter')
  await expect(page.getByText('Ваш ответ')).toBeVisible()
  await expect(page.getByText('Правильно', { exact: true })).toBeVisible()
  await input.press('Enter') // «Далее» (the ✓ next to the field turns into it too)
  await expect(page.getByText('2 / 2')).toBeVisible()
  await input.fill(fullGreek(await prompt()))
  await input.press('Enter')
  await expect(page.getByText('Верно!')).toBeVisible()
  await input.press('Enter')

  // Round 2: only the word with the mistake. «Не знаю» shows it — and keeps it for round 3.
  await expect(page.getByText('Круг 2 · 1 / 1')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Круг 2: слова, где были ошибки')
  expect(await prompt()).toEqual(first)
  await page.getByRole('button', { name: 'Не знаю' }).click()
  await expect(page.getByText(fullGreek(first)).first()).toBeVisible()
  await input.press('Enter') // «Далее» (the ✓ next to the field turns into it too)

  await expect(page.getByText('Круг 3 · 1 / 1')).toBeVisible()
  await expect(input).toHaveValue('') // the same word again, a clean field
  await input.fill(fullGreek(first))
  await input.press('Enter')
  await expect(page.getByText('Верно!')).toBeVisible()
  await input.press('Enter')

  await expect(page.getByText('Все 2 слова написаны верно')).toBeVisible()
  await expect(page.getByText('Кругов: 3')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: fullGreek(first) })).toContainText(
    'ошибок: 2',
  )
  await page.getByRole('button', { name: 'В меню' }).click()
  await untilRight.uncheck() // leave the shared user as it was
  await page.waitForTimeout(700)
})

test('write: «Я ответил правильно» counts a wrong answer as right — in the result and rounds', async ({
  page,
}) => {
  await page.goto('/write')
  await setSlider(page, 1)
  await page.getByRole('button', { name: 'Начать' }).click()
  const input = page.getByLabel('Ответ по-гречески')
  const word = findWord((await page.locator('article p').textContent())!.trim())
  await input.fill(fullGreek(word).normalize('NFD').replace(/́/g, '')) // no accent
  await input.press('Enter')
  await page.getByRole('button', { name: 'Я ответил правильно' }).click()
  await expect(page.getByText('Засчитано как верно ✓')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Я ответил правильно' })).toHaveCount(0)
  await input.press('Enter')
  await expect(page.getByText('Правильно 1 из 1')).toBeVisible()

  // «Добивать до правильного ответа»: an accepted word doesn't come back in round 2.
  await page.getByRole('button', { name: 'В меню' }).click()
  const untilRight = page.getByLabel('Добивать до правильного ответа')
  await untilRight.check()
  await page.getByRole('button', { name: 'Начать' }).click()
  const again = findWord((await page.locator('article p').textContent())!.trim())
  await input.fill(fullGreek(again).normalize('NFD').replace(/́/g, ''))
  await input.press('Enter')
  await page.getByRole('button', { name: 'Я ответил правильно' }).click()
  await input.press('Enter')
  await expect(page.getByText('Кругов: 1')).toBeVisible()
  await page.getByRole('button', { name: 'В меню' }).click()
  await untilRight.uncheck() // leave the shared user as it was
  await page.waitForTimeout(700)
})

test('write: the site keyboard — ⇧ for one capital, ⇪ for all, punctuation', async ({ page }) => {
  await page.goto('/write')
  const screen = page.getByLabel('Экранная клавиатура')
  await screen.check()
  await setSlider(page, 1)
  await page.getByRole('button', { name: 'Начать' }).click()
  const keyboard = page.getByRole('group', { name: 'Греческая клавиатура' })
  const key = (k: string) => keyboard.getByRole('button', { name: k, exact: true }).click()
  const input = page.getByLabel('Ответ по-гречески')

  await key('Заглавные')
  await expect(keyboard.getByRole('button', { name: 'Τ', exact: true })).toBeVisible() // capitals shown
  await key('Τ')
  await key('ο') // the shift was for one letter only
  await key('Пробел')
  await key('Заглавные')
  await key('Заглавные') // twice: ⇪
  await key('Ν')
  await key('Ε')
  await key('Ударение')
  await key('Ό') // an accented capital
  await key('Заглавные') // off
  await key('Вопросительный знак (;)')
  await key('Запятая')
  await key('Апостроф')
  await expect(input).toHaveValue("Το ΝΕΌ;,'")

  // Holding a vowel types it with the accent; a plain tap — without.
  const alpha = keyboard.getByRole('button', { name: 'α', exact: true })
  const box = (await alpha.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(600)
  await page.mouse.up()
  await alpha.click()
  await expect(input).toHaveValue("Το ΝΕΌ;,'άα")

  await page.getByRole('button', { name: 'Не знаю' }).click()
  await expect(page.getByText('Ваш ответ')).toBeVisible()
  await input.press('Enter')
  await page.getByRole('button', { name: 'В меню' }).click()
  await screen.uncheck() // leave the shared user as it was
  await page.waitForTimeout(700)
})
