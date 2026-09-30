import { useEffect, useState } from 'react'
import { api } from '../api/client.ts'
import type { Category } from '../api/types.ts'

/** All categories (for pickers and labels). `reload` after creating/renaming one. */
export function useCategories(): [Category[] | null, () => void] {
  const [list, setList] = useState<Category[] | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    api<Category[]>('/categories')
      .then(setList)
      .catch(() => setList([]))
  }, [version])
  return [list, () => setVersion((v) => v + 1)]
}

export const categoryLabel = (c: Pick<Category, 'name' | 'emoji'>) =>
  c.emoji ? `${c.emoji} ${c.name}` : c.name
