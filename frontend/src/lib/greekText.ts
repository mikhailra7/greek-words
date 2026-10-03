// Words of a line, for the dialogue modes that hide or shuffle them (SPEC «Диалоги», Д4.3–Д4.5).

export type Token = { text: string; word: boolean }

// A word: letters and digits (accented Greek included), with an inner apostrophe (σ’ αγαπώ).
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu

/** The line split into words and what's between them (spaces, punctuation), in order. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  for (const m of text.matchAll(WORD)) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index), word: false })
    tokens.push({ text: m[0], word: true })
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ text: text.slice(last), word: false })
  return tokens
}

export const words = (text: string): string[] =>
  tokenize(text)
    .filter((t) => t.word)
    .map((t) => t.text)

// «Постепенное скрытие»: level → share of words hidden. Level 3 hides them all.
export const HIDE_LEVELS = [0, 0.3, 0.6, 1] as const

/** Indexes (among the line's words) hidden at `level`. Not random: every word has a fixed
 * place in the queue (from the line id), so a higher level hides the same words plus more. */
export function hiddenWords(lineId: number, wordCount: number, level: number): Set<number> {
  if (level <= 0 || wordCount === 0) return new Set()
  const share = HIDE_LEVELS[Math.min(level, 3)]
  const count = level >= 3 ? wordCount : Math.max(1, Math.round(wordCount * share))
  const queue = Array.from({ length: wordCount }, (_, i) => i).sort(
    (a, b) => rank(lineId, a) - rank(lineId, b) || a - b,
  )
  return new Set(queue.slice(0, count))
}

// A fixed pseudo-random number per (line, word).
function rank(lineId: number, i: number): number {
  let h = (lineId * 2654435761 + (i + 1) * 40503) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 2246822507) >>> 0
  h ^= h >>> 13
  return h >>> 0
}
