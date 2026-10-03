import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { silentWav } from './helpers.ts'

// The example dialogue «Знакомство» (SPEC «Диалоги», Д7), under a unique title per run.
const EXAMPLE = JSON.parse(
  readFileSync(new URL('../../backend/app/seed/dialogue_znakomstvo.json', import.meta.url), 'utf8'),
)
const example = (title: string) => ({ ...EXAMPLE, title })

/** Count the dialogue audio the page asks for; the server's TTS is off in e2e. */
async function recordAudio(page: Page): Promise<string[]> {
  const urls: string[] = []
  await page.route(/\/api\/dialogue-lines\/\d+\/audio/, (route) => {
    urls.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() })
  })
  return urls
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.use({ viewport: { width: 360, height: 740 } }) // acceptance: every mode at 360 px

test('dialogues: list → «Чтение»: chat, what to show, tap to hear, the whole dialogue', async ({
  page,
  request,
}) => {
  const title = `Знакомство ${Date.now()}`
  const created = await request.post('/api/dialogues/import', { data: example(title) })
  expect(created.status()).toBe(201)
  const audio = await recordAudio(page)

  await page.goto('/dialogues')
  const card = page.getByRole('listitem').filter({ hasText: title })
  await expect(card).toContainText('Μαρία · Νίκος · 7 реплик')
  await card.getByRole('link', { name: 'Учить' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Чтение' })).toHaveAttribute('aria-selected', 'true')
  expect(await noSideScroll(page)).toBe(true)

  // All three layers are on by default; «Перевод» off hides the Russian, and it's remembered.
  await expect(page.getByText('Привет! Как тебя зовут?')).toBeVisible()
  await expect(page.getByText('Ya su! Pos se léne?')).toBeVisible()
  await page.getByRole('button', { name: 'Перевод' }).click()
  await expect(page.getByText('Привет! Как тебя зовут?')).toHaveCount(0)
  await page.waitForTimeout(700) // settings are saved with a short debounce
  await page.reload()
  await expect(page.getByText('Γεια σου! Πώς σε λένε;')).toBeVisible()
  await expect(page.getByText('Привет! Как тебя зовут?')).toHaveCount(0)
  await page.getByRole('button', { name: 'Перевод' }).click()
  await expect(page.getByText('Привет! Как тебя зовут?')).toBeVisible()

  // A tap plays the line; on the site voice the second role speaks in the male voice…
  await page.getByRole('button', { name: /Με λένε Νίκο/ }).click()
  await expect.poll(() => audio.at(-1) ?? '').toContain('voice=male')
  // …unless «Один голос для всех ролей».
  await page.getByLabel('Один голос для всех ролей').check()
  await page.getByRole('button', { name: /Με λένε Νίκο/ }).click()
  await expect.poll(() => audio.length).toBe(2)
  expect(audio[1]).not.toContain('voice=male')
  await page.getByLabel('Один голос для всех ролей').uncheck()

  // «Прослушать весь диалог»: line after line, then back to the start button.
  const before = audio.length
  await page.getByRole('button', { name: '▶ Прослушать весь диалог' }).click()
  await expect(page.getByRole('button', { name: '⏸ Пауза' })).toBeVisible()
  await expect.poll(() => audio.length - before, { timeout: 15_000 }).toBe(7)
  await expect(page.getByRole('button', { name: '▶ Прослушать весь диалог' })).toBeVisible({
    timeout: 5_000,
  })
  expect(await noSideScroll(page)).toBe(true)
})

test('dialogues: «По ролям» — the partner speaks, mine is hidden until «Показать»', async ({
  page,
  request,
}) => {
  const title = `По ролям ${Date.now()}`
  const d = await (await request.post('/api/dialogues/import', { data: example(title) })).json()
  const audio = await recordAudio(page)

  await page.goto(`/dialogues/${d.id}`)
  await page.getByRole('tab', { name: 'По ролям' }).click()
  await page.getByRole('radio', { name: 'Νίκος' }).click()
  await page.getByRole('button', { name: 'Начать' }).click()

  // Μαρία's line plays by itself; then my (Νίκος) line: only the translation.
  await expect.poll(() => audio.length).toBeGreaterThan(0)
  await expect(page.getByText('Меня зовут Никос. А тебя?')).toBeVisible()
  await expect(page.getByText('Με λένε Νίκο. Εσένα;')).toHaveCount(0)
  expect(await noSideScroll(page)).toBe(true)

  const myLine = async (greek: string, knew: boolean) => {
    const show = page.getByRole('button', { name: 'Показать' })
    await expect(show).toBeVisible({ timeout: 5_000 })
    const played = audio.length
    await show.click()
    await expect(page.getByText(greek)).toBeVisible()
    await expect.poll(() => audio.length).toBe(played + 1) // hear how it sounds
    await page.getByRole('button', { name: knew ? 'Знал' : 'Не знал', exact: true }).click()
  }
  await myLine('Με λένε Νίκο. Εσένα;', true)
  await myLine('Κι εγώ. Από πού είσαι;', false)
  await myLine('Σου αρέσει η Ελλάδα;', true)

  await expect(page.getByText('Знал 2 из 3')).toBeVisible({ timeout: 5_000 })
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Κι εγώ. Από πού είσαι;' }),
  ).toBeVisible()
  expect(await noSideScroll(page)).toBe(true)
  await page.getByRole('button', { name: 'Сменить роль' }).click()
  await expect(page.getByRole('radiogroup', { name: 'Ваша роль' })).toBeVisible()
  await page.getByRole('tab', { name: 'Чтение' }).click() // leave the shared user as it was
  await page.waitForTimeout(700)
})

test('dialogues: one upload button for both kinds; readable errors; replace and delete', async ({
  page,
}) => {
  const title = `Через словари ${Date.now()}`
  // A dialogue file given to «Словари» → «Загрузить JSON / архив» opens as a dialogue.
  await page.goto('/dictionaries')
  await page.locator('input[type=file]').setInputFiles({
    name: 'dialogue.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(example(title))),
  })
  await expect(page).toHaveURL(/\/dialogues\/\d+$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  // A broken file names the line and the field.
  await page.goto('/dialogues')
  const broken = example('Сломанный')
  broken.lines = [{ ...broken.lines[0], translation_ru: '' }, broken.lines[1]]
  await page.getByLabel('Файл диалога (JSON)').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(broken)),
  })
  await expect(page.getByRole('alert')).toContainText('реплика 1, поле translation_ru: пусто')

  // «Заменить из JSON» keeps the place, «Удалить» removes it (both ask first).
  const card = page.getByRole('listitem').filter({ hasText: title })
  page.once('dialog', (dlg) => dlg.accept())
  await card.getByLabel(`Заменить «${title}» из JSON`).setInputFiles({
    name: 'short.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...example(title), lines: EXAMPLE.lines.slice(0, 2) })),
  })
  await expect(card).toContainText('2 реплики')
  page.once('dialog', (dlg) => dlg.accept())
  await card.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: title })).toHaveCount(0)
})

test('dialogues: «Пауза между репликами» — one line per →, on from a tapped one', async ({
  page,
  request,
}) => {
  const d = await (
    await request.post('/api/dialogues/import', { data: example(`По одной ${Date.now()}`) })
  ).json()
  const lineAudio = (i: number) => `/api/dialogue-lines/${d.lines[i].id}/audio`
  const audio = await recordAudio(page)
  await page.goto(`/dialogues/${d.id}`)

  const step = page.getByLabel('Пауза между репликами')
  await step.check()
  await expect(page.getByRole('button', { name: '▶ Прослушать весь диалог' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Первая реплика →' }).click()
  await expect.poll(() => audio.at(-1) ?? '').toContain(lineAudio(0))
  await page.getByRole('button', { name: 'Следующая реплика' }).click()
  await expect.poll(() => audio.at(-1) ?? '').toContain(lineAudio(1))
  expect(audio).toHaveLength(2) // nothing plays on its own

  // A tapped line is where → goes on from; after the last one — from the start.
  await page.getByRole('button', { name: /Σου αρέσει η Ελλάδα/ }).click()
  await expect.poll(() => audio.at(-1) ?? '').toContain(lineAudio(5))
  await page.getByRole('button', { name: 'Следующая реплика' }).click()
  await expect.poll(() => audio.at(-1) ?? '').toContain(lineAudio(6))
  await page.getByRole('button', { name: '↺ С начала' }).click()
  await expect.poll(() => audio.at(-1) ?? '').toContain(lineAudio(0))
  expect(await noSideScroll(page)).toBe(true)

  await step.uncheck() // leave the shared user as it was
  await expect(page.getByRole('button', { name: '▶ Прослушать весь диалог' })).toBeVisible()
  await page.waitForTimeout(700)
})

test('dialogues: a member reads and learns, but adds / replaces / deletes nothing', async ({
  browser,
  request,
}) => {
  const title = `Для участника ${Date.now()}`
  await request.post('/api/dialogues/import', { data: example(title) })
  const invite = await (await request.post('/api/admin/invites', { data: {} })).json()
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const reg = await ctx.request.post('/api/auth/register', {
    data: {
      username: `dlg_member_${Date.now()}`,
      password: 'member-pass',
      invite_code: invite.code,
    },
  })
  expect(reg.ok()).toBeTruthy()
  const page = await ctx.newPage()
  await page.goto('/dialogues')
  const card = page.getByRole('listitem').filter({ hasText: title })
  await expect(card.getByRole('link', { name: 'Учить' })).toBeVisible()
  for (const name of ['Заменить из JSON', 'Скачать JSON', 'Удалить'])
    await expect(card.getByText(name)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Загрузить JSON' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Вставить ответ Claude' })).toHaveCount(0)
  await ctx.close()
})

test('dialogues: «Скрытие слов» — levels hide more of the same words; peeks; next level', async ({
  page,
  request,
}) => {
  const d = await (
    await request.post('/api/dialogues/import', { data: example(`Скрытие ${Date.now()}`) })
  ).json()
  const allWords = EXAMPLE.lines.flatMap(
    (l: { greek: string }) => l.greek.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [],
  ).length
  await page.goto(`/dialogues/${d.id}`)
  await page.getByRole('tab', { name: 'Скрытие слов' }).click()

  const blanks = page.getByRole('button', { name: 'Скрытое слово — открыть' })
  // Which words are hidden: «line number:word», read from the invisible text of the blanks.
  const hiddenNow = () =>
    page
      .locator('ul > li')
      .evaluateAll((items) =>
        items.flatMap((li, i) =>
          [...li.querySelectorAll('button[aria-label="Скрытое слово — открыть"]')].map(
            (b) => `${i}:${b.textContent}`,
          ),
        ),
      )
  const level = (n: number) => page.getByRole('radio', { name: new RegExp(`^Уровень ${n}:`) })

  await expect(blanks).toHaveCount(0) // level 0: the whole text
  await level(1).click()
  const one = await hiddenNow()
  expect(one.length).toBeGreaterThanOrEqual(EXAMPLE.lines.length) // at least one per line
  await level(2).click()
  const two = await hiddenNow()
  expect(two.length).toBeGreaterThan(one.length)
  expect(one.every((w) => two.includes(w))).toBe(true) // the same words, plus more
  await level(3).click()
  await expect(blanks).toHaveCount(allWords) // only the translation is left
  await expect(page.getByText('Привет! Как тебя зовут?')).toBeVisible()
  expect(await noSideScroll(page)).toBe(true)

  // A peek opens one word; «Готово» hides them again and tells how many were opened.
  await level(1).click()
  await blanks.first().click()
  await expect(blanks).toHaveCount(one.length - 1)
  await page.getByRole('button', { name: 'Готово (подсмотрено: 1)' }).click()
  await expect(page.getByRole('status')).toContainText('Подсмотрено слов: 1')
  await expect(blanks).toHaveCount(one.length)

  // Without peeks: on to the next level — and it's remembered for this dialogue.
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Без подсказок! Уровень 2')
  await expect(level(2)).toHaveAttribute('aria-checked', 'true')
  await page.waitForTimeout(700) // settings are saved with a short debounce
  await page.reload()
  await expect(level(2)).toHaveAttribute('aria-checked', 'true')

  await page.getByRole('tab', { name: 'Чтение' }).click() // leave the shared user as it was
  await page.waitForTimeout(700)
})

test('dialogues: «Сборка фразы» — chips in order, wrong ones red, «Показать ответ», result', async ({
  page,
  request,
}) => {
  const d = await (
    await request.post('/api/dialogues/import', { data: example(`Сборка ${Date.now()}`) })
  ).json()
  const audio = await recordAudio(page)
  await page.goto(`/dialogues/${d.id}`)
  await page.getByRole('tab', { name: 'Сборка фразы' }).click()
  await page.getByRole('radio', { name: 'Νίκος' }).click()
  await page.getByRole('button', { name: 'Начать' }).click()

  const pool = page.locator('[aria-label="Слова"]')
  const built = page.locator('[aria-label="Собранная фраза"]')
  const place = async (...ws: string[]) => {
    for (const w of ws) await pool.getByRole('button', { name: w, exact: true }).click()
  }

  // Μαρία's line is context: it plays by itself. Then mine — translation and chips.
  await expect.poll(() => audio.length).toBeGreaterThan(0)
  await expect(page.getByText('Меня зовут Никос. А тебя?')).toBeVisible()
  await expect(pool.getByRole('button')).toHaveCount(4) // Με λένε Νίκο Εσένα, no punctuation
  expect(await noSideScroll(page)).toBe(true)

  await place('Εσένα', 'Με', 'λένε', 'Νίκο') // wrong order
  await expect(page.getByRole('status')).toContainText('Не тот порядок')
  await expect(built.locator('button.border-red-500')).toHaveCount(4)
  for (const w of ['Εσένα', 'Με', 'λένε', 'Νίκο'])
    await built.getByRole('button', { name: w, exact: true }).click() // back to the pool
  const played = audio.length
  await place('Με', 'λένε', 'Νίκο', 'Εσένα')
  await expect(page.getByText('Με λένε Νίκο. Εσένα;')).toBeVisible() // with the punctuation
  await expect.poll(() => audio.length).toBe(played + 1) // and it plays
  await page.getByRole('button', { name: 'Далее' }).click()

  await expect(page.getByText('Мне тоже. Откуда ты?')).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: 'Показать ответ' }).click()
  await expect(page.getByText('Κι εγώ. Από πού είσαι;')).toBeVisible()
  await page.getByRole('button', { name: 'Далее' }).click()

  await expect(page.getByText('Тебе нравится Греция?')).toBeVisible({ timeout: 5_000 })
  await place('Σου', 'αρέσει', 'η', 'Ελλάδα')
  await page.getByRole('button', { name: 'Далее' }).click()

  await expect(page.getByText('С первого раза: 1 из 3')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('listitem').filter({ hasText: 'Με λένε Νίκο. Εσένα;' })).toBeVisible()
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Κι εγώ. Από πού είσαι;' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Другие реплики' }).click()
  await expect(page.getByRole('radiogroup', { name: 'Какие реплики' })).toBeVisible()
  await page.getByRole('tab', { name: 'Чтение' }).click() // leave the shared user as it was
  await page.waitForTimeout(700)
})

test('dialogues: «Ввод по памяти» — lenient check, differing words marked, «Не знаю»', async ({
  page,
  request,
}) => {
  const d = await (
    await request.post('/api/dialogues/import', { data: example(`Ввод ${Date.now()}`) })
  ).json()
  const audio = await recordAudio(page)
  await page.goto(`/dialogues/${d.id}`)
  await page.getByRole('tab', { name: 'Ввод по памяти' }).click()
  await page.getByRole('radio', { name: 'Νίκος' }).click()
  await page.getByLabel('Экранная клавиатура').check()
  await page.getByRole('button', { name: 'Начать' }).click()

  const field = page.getByLabel('Реплика по-гречески')
  await expect(page.getByText('Меня зовут Никос. А тебя?')).toBeVisible({ timeout: 5_000 })
  await expect(field).toHaveAttribute('inputmode', 'none') // the device keyboard stays closed
  await expect(page.getByRole('group', { name: 'Греческая клавиатура' })).toBeVisible()
  expect(await noSideScroll(page)).toBe(true)

  // No accents, no capitals, no punctuation, σ for ς: still right; the line is shown as it is.
  const played = audio.length
  await field.fill('με λενε νικο εσενα')
  await field.press('Enter')
  await expect(page.getByText('Верно!')).toBeVisible()
  await expect(page.getByLabel('Правильно')).toHaveText('Με λένε Νίκο. Εσένα;')
  await expect.poll(() => audio.length).toBe(played + 1)
  await page.getByRole('button', { name: 'Далее' }).click()

  // One wrong word: only it is marked (red in mine, green in the right line).
  await expect(page.getByText('Мне тоже. Откуда ты?')).toBeVisible({ timeout: 5_000 })
  await field.fill('Κι εγώ. Από πού ησαι;')
  await page.getByRole('button', { name: 'Проверить' }).click()
  await expect(page.getByText('Есть отличия')).toBeVisible()
  await expect(page.getByLabel('Ваш ответ').locator('.bg-red-100')).toHaveText(['ησαι'])
  await expect(page.getByLabel('Правильно').locator('.bg-green-100')).toHaveText(['είσαι'])
  await expect(page.getByLabel('Правильно')).toHaveText('Κι εγώ. Από πού είσαι;') // punctuation kept
  await page.getByRole('button', { name: 'Далее' }).click()

  // Latin letters get a hint; «Не знаю» shows the line and counts as wrong.
  await expect(page.getByText('Тебе нравится Греция?')).toBeVisible({ timeout: 5_000 })
  await field.fill('Sou aresei')
  await field.press('Enter')
  await expect(page.getByText('Похоже, введены латинские буквы')).toBeVisible()
  await page.getByRole('button', { name: 'Далее' }).click()

  await expect(page.getByText('Верно: 1 из 3')).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: 'Другие реплики' }).click()
  await page.getByLabel('Экранная клавиатура').uncheck() // leave the shared user as it was
  await page.getByRole('tab', { name: 'Чтение' }).click()
  await page.waitForTimeout(700)
})

test('dialogues: «Ввод по памяти» — «Не знаю» shows the line', async ({ page, request }) => {
  const d = await (
    await request.post('/api/dialogues/import', { data: example(`Не знаю ${Date.now()}`) })
  ).json()
  await recordAudio(page)
  await page.goto(`/dialogues/${d.id}`)
  await page.getByRole('tab', { name: 'Ввод по памяти' }).click()
  await page.getByRole('button', { name: 'Начать' }).click() // all lines
  await page.getByRole('button', { name: 'Не знаю' }).click()
  await expect(page.getByText('Правильно так:')).toBeVisible()
  await expect(page.getByLabel('Правильно')).toHaveText('Γεια σου! Πώς σε λένε;')
  await page.getByRole('tab', { name: 'Чтение' }).click()
  await page.waitForTimeout(700)
})
