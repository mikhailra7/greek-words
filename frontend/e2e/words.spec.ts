import { expect, test } from '@playwright/test'
import { seedDictionary } from './helpers.ts'

test('word form: three translation fields, more appear up to five, five are saved', async ({
  page,
  request,
}) => {
  const dict = await seedDictionary(request, `Переводы ${Date.now()}`, [])
  await page.goto(`/dictionaries/${dict}`)
  await page.getByRole('button', { name: '+ Слово' }).click()
  await page.getByLabel('Греческое слово').fill('νερό')

  const extra = page.getByPlaceholder('ещё вариант (необязательно)')
  await page.getByPlaceholder('основной перевод').fill('вода')
  await expect(extra).toHaveCount(2) // three fields to start with
  await extra.nth(0).fill('водичка')
  await extra.nth(1).fill('водица')
  await expect(extra).toHaveCount(3) // a fourth one appears…
  await extra.nth(2).fill('влага')
  await expect(extra).toHaveCount(4) // …and a fifth
  await extra.nth(3).fill('жидкость')
  await expect(extra).toHaveCount(4) // never a sixth
  await page.getByRole('button', { name: 'Добавить' }).click()

  await expect(page.getByText('вода, водичка, водица, влага, жидкость')).toBeVisible()
})
