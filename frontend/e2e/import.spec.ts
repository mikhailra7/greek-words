import { expect, test } from '@playwright/test'

// Answer as Claude would give it (fenced, with chatter) for e2e/fixtures/lesson.pdf:
// a red square captioned νερό and a blue square captioned ψωμί.
const CLAUDE_ANSWER = `Вот результат:
\`\`\`json
{"schema_version": 1, "title": "Урок e2e", "words": [
 {"article": "το", "greek": "νερό", "transcription": "to neró", "translations_ru": ["вода"],
  "part_of_speech": "noun", "image_emoji": "💧", "page": 1, "bbox": [0.1, 0.1, 0.4, 0.35]},
 {"article": "το", "greek": "ψωμί", "transcription": "to psomí", "translations_ru": ["хлеб"],
  "part_of_speech": "noun", "image_emoji": "🍞", "page": 1, "bbox": [0.55, 0.1, 0.85, 0.35]},
 {"article": "το", "greek": "κουλούρι", "transcription": "to kulúri", "translations_ru": ["бублик"],
  "part_of_speech": "noun", "page": 1, "bbox": null, "category": "Хлебобулочные e2e"}
]}
\`\`\``

test('textbook import: upload → pages → paste Claude answer → draft → publish', async ({
  page,
}) => {
  await page.goto('/dictionaries')
  await page.getByRole('button', { name: 'Импорт из учебника' }).click()
  await expect(page).toHaveURL(/\/import$/)

  await page.locator('input[type=file][multiple]').setInputFiles('e2e/fixtures/lesson.pdf')
  await expect(page).toHaveURL(/\/import\/\d+$/)
  await expect(page.getByText('1. Какие страницы разобрать?')).toBeVisible()
  await page.getByRole('button', { name: 'Дальше: 1 стр.' }).click()

  await expect(page.getByRole('link', { name: /Скачать PDF/ })).toBeVisible()
  await page.getByPlaceholder('{"schema_version"').fill('Извини, не получилось')
  await page.getByRole('button', { name: 'Проверить' }).click()
  await expect(page.getByRole('alert')).toContainText('Не нашёл JSON')

  await page.getByPlaceholder('{"schema_version"').fill(CLAUDE_ANSWER)
  await page.getByRole('button', { name: 'Проверить' }).click()

  await expect(page.getByText('3. Проверьте черновик')).toBeVisible()
  await expect(page.getByText('с картинкой 2')).toBeVisible()
  await expect(page.getByLabel('Название словаря')).toHaveValue('Урок e2e')

  // Claude proposed a category that doesn't exist yet → create it from the draft.
  await expect(page.getByText('✨ новая категория: «Хлебобулочные e2e»')).toBeVisible()
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByText('Хлебобулочные e2e', { exact: true })).toBeVisible()
  await expect(page.getByText('✨ новая категория')).toHaveCount(0)

  await page.getByRole('button', { name: /Опубликовать: 3 слова/ }).click()
  await expect(page).toHaveURL(/\/dictionaries\/\d+$/)
  await expect(page.getByRole('heading', { name: 'Урок e2e' })).toBeVisible()
  const pictures = page.locator('ul img')
  await expect(pictures).toHaveCount(2)
  await expect(pictures.first()).toHaveAttribute('src', /^\/media\/images\//)
  await expect(page.getByText('Хлебобулочные e2e')).toBeVisible() // category survived publishing
})
