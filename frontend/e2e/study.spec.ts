import { expect, test } from '@playwright/test'
import { seedDictionary } from './helpers.ts'

// «учить» on words (SPEC): the dictionary's / category's tick is «all of its words».
test('«учить» on words: the dictionary tick ticks all, one off makes it «–»; categories keep theirs', async ({
  page,
  request,
}) => {
  const stamp = Date.now()
  const dict = await seedDictionary(request, `Учить ${stamp}`, [
    { greek: `ένα${stamp}`, translations_ru: ['один'] },
    { greek: `δύο${stamp}`, translations_ru: ['два'] },
  ])
  const words = (await (await request.get(`/api/dictionaries/${dict}`)).json()).words
  const cat = await (await request.post('/api/categories', { data: { name: `Учить ${stamp}` } })).json()
  await request.patch(`/api/words/${words[0].id}/category`, { data: { category_id: cat.id } })

  await page.goto(`/dictionaries/${dict}`)
  const all = page.getByLabel('Использовать в тренировках', { exact: true })
  const one = page.getByLabel(`Изучать: ένα${stamp}`)
  const two = page.getByLabel(`Изучать: δύο${stamp}`)
  // Each click is saved at once; wait for the server before the next one / a reload.
  const saved = (path: string) => page.waitForResponse((r) => r.url().includes(path) && r.ok())
  let done = saved('/active')
  await all.check()
  await done
  await expect(one).toBeChecked()
  await expect(two).toBeChecked()

  done = saved('/study')
  await two.uncheck()
  await done
  await expect(all).not.toBeChecked()
  expect(await all.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true)
  await expect(page.getByText('· отмечено 1 из 2')).toBeVisible()
  await page.reload()
  await expect(one).toBeChecked()
  await expect(two).not.toBeChecked() // saved on the server

  // In the category the word is ticked separately; unticking the dictionary keeps it.
  await page.goto(`/categories/${cat.id}`)
  const inCat = page.getByLabel(`Изучать: ένα${stamp}`)
  await expect(inCat).not.toBeChecked()
  done = saved('/study')
  await inCat.check()
  await done
  await expect(page.getByLabel('Использовать в тренировках', { exact: true })).toBeChecked()
  await page.goto(`/dictionaries/${dict}`)
  done = saved('/active')
  await all.check()
  await done
  done = saved('/active')
  await all.uncheck()
  await done
  await expect(one).not.toBeChecked()
  const pool = await (
    await request.get('/api/training/words?count=2000&hide_known=false')
  ).json()
  const greek = pool.map((w: { greek: string }) => w.greek)
  expect(greek).toContain(`ένα${stamp}`)
  expect(greek).not.toContain(`δύο${stamp}`)

  // Leave the shared user as it was.
  await request.put(`/api/categories/${cat.id}/active`, { data: { active: false } })
})

test('«Есть в словарях»: the same word in other dictionaries, with links in the card', async ({
  page,
  request,
}) => {
  const stamp = Date.now()
  const word = `δίδυμο${stamp}`
  const first = await seedDictionary(request, `Двойник A ${stamp}`, [
    { greek: word, translations_ru: ['близнец'] },
  ])
  const second = await seedDictionary(request, `Двойник B ${stamp}`, [
    { greek: word, translations_ru: ['близнец'] },
  ])
  await page.goto(`/dictionaries/${first}`)
  await expect(page.getByText(`Есть в словарях: Двойник B ${stamp}`)).toBeVisible()
  await page.getByText(word, { exact: true }).click() // the word's card
  await page.getByRole('link', { name: `Двойник B ${stamp}` }).click()
  await expect(page).toHaveURL(new RegExp(`/dictionaries/${second}$`))
  await expect(page.getByRole('heading', { name: `Двойник B ${stamp}` })).toBeVisible()
  await expect(page.getByText(`Есть в словарях: Двойник A ${stamp}`)).toBeVisible()
})
