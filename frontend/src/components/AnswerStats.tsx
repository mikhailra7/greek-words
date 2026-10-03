// «5/7» next to a word on the dictionary and category pages: right answers out of the user's
// last 10 to it in «Переведи», «Напиши» and «Микс». Nothing when the word wasn't met yet.

export default function AnswerStats({
  answers,
}: {
  answers?: { right: number; total: number } | null
}) {
  if (!answers) return null
  const share = answers.right / answers.total
  const color =
    share >= 0.8
      ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
      : share >= 0.5
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
        : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
  return (
    <span
      className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${color}`}
      title={`Последние ответы: ${answers.right} правильных из ${answers.total}`}
      aria-label={`Последние ответы: ${answers.right} из ${answers.total}`}
    >
      {answers.right}/{answers.total}
    </span>
  )
}
