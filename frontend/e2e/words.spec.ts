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

test('word order: ↑ ↓ and dragging by ⋮⋮, saved at once', async ({ page, request }) => {
  const dict = await seedDictionary(request, `Порядок ${Date.now()}`, [
    { greek: 'ένα', translations_ru: ['один'] },
    { greek: 'δύο', translations_ru: ['два'] },
    { greek: 'τρία', translations_ru: ['три'] },
    { greek: 'τέσσερα', translations_ru: ['четыре'] },
  ])
  const order = async () =>
    (
      (await (await request.get(`/api/dictionaries/${dict}`)).json()).words as { greek: string }[]
    ).map((w) => w.greek)
  await page.goto(`/dictionaries/${dict}`)
  await page.getByRole('button', { name: '↕ Порядок слов' }).click()
  const list = page.getByRole('list', { name: 'Порядок слов' })
  await expect(list.getByRole('listitem')).toHaveCount(4)

  await page.getByRole('button', { name: 'Ниже: ένα' }).click()
  await expect.poll(order).toEqual(['δύο', 'ένα', 'τρία', 'τέσσερα'])
  await expect(page.getByRole('button', { name: 'Выше: δύο' })).toBeDisabled() // first now

  // Drag τέσσερα by its handle up onto the first row.
  const handle = page.getByRole('button', { name: 'Перетащить τέσσερα' })
  const first = (await list.getByRole('listitem').first().boundingBox())!
  const from = (await handle.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, first.y + 5, { steps: 12 })
  await page.mouse.up()
  await expect.poll(order).toEqual(['τέσσερα', 'δύο', 'ένα', 'τρία'])

  await page.getByRole('button', { name: 'Готово' }).click()
  await page.reload()
  await expect(page.locator('li [lang=el].text-lg').first()).toHaveText('τέσσερα')
})
