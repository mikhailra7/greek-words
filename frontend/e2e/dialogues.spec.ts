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
