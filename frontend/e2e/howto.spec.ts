import { expect, test } from '@playwright/test'

test('«Как добавить словари»: instructions, prompts, word list pasted from Claude', async ({
  page,
}) => {
  await page.goto('/dictionaries')
  await page.getByRole('tab', { name: /Как добавить/ }).click()
  await expect(page).toHaveURL(/tab=help/)

  // Textbook section is open with the main prompt (current categories filled in).
  await expect(page.getByText('Страницы учебника через claude.ai')).toBeVisible()
  const copyButtons = page.getByRole('button', { name: 'Скопировать промпт' })
  await expect(copyButtons.first()).toBeEnabled()
  await page.getByText('Показать текст промпта').first().click()
  await expect(page.locator('pre').filter({ hasText: 'bbox' })).toBeVisible()

  // Word list: prompt + paste Claude's answer (with the ```json fence) → a new dictionary.
  await page.getByText('3. Список слов без учебника').click()
  await expect(copyButtons.nth(1)).toBeEnabled()
  const title = `Список ${Date.now()}`
  await page.getByLabel('JSON от Claude').fill(
    'Готово:\n```json\n' +
      JSON.stringify({
        schema_version: 1,
        title,
        words: [
          {
            article: 'ο',
            greek: 'καφές',
            transcription: 'o kafés',
            translations_ru: ['кофе'],
            part_of_speech: 'noun',
            image_emoji: '☕',
            image_query: 'coffee',
            note: null,
          },
        ],
      }) +
      '\n```',
  )
  await page.getByRole('button', { name: 'Создать словарь' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText('ο καφές').first()).toBeVisible()

  // A broken answer gets a readable error instead of a dictionary.
  await page.goto('/dictionaries?tab=help')
  await page.getByText('3. Список слов без учебника').click()
  await page.getByLabel('JSON от Claude').fill('{"title": "x", "words": [{"greek": "λάθος"}]}')
  await page.getByRole('button', { name: 'Создать словарь' }).click()
  await expect(page.getByText(/слово 1, поле translations_ru/)).toBeVisible()
})
