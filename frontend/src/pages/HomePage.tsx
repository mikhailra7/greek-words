import { Link } from 'react-router'
import { activeSummaryText } from '../api/types.ts'
import {
  IconBook,
  IconCards,
  IconHeadphones,
  IconPencil,
  IconShuffle,
  IconSwap,
} from '../components/icons.tsx'
import { useActiveCount } from '../trainers/common.tsx'

const MODES = [
  {
    to: '/study',
    title: 'Изучение слов',
    hint: 'Карточки: слово, картинка, перевод',
    Icon: IconCards,
  },
  { to: '/translate', title: 'Переведи слово', hint: 'Выбрать перевод из четырёх', Icon: IconSwap },
  { to: '/write', title: 'Напиши', hint: 'Написать слово по-гречески', Icon: IconPencil },
  { to: '/mix', title: 'Микс заданий', hint: 'Переведи и Напиши вперемешку', Icon: IconShuffle },
  {
    to: '/listen',
    title: 'Аудио повторение',
    hint: 'Слушать: греческий → русский',
    Icon: IconHeadphones,
  },
  { to: '/dictionaries', title: 'Словари', hint: 'Выбрать слова для тренировок', Icon: IconBook },
]

// The start page: every mode one tap away, and what the trainers will draw words from.
export default function HomePage() {
  const active = useActiveCount()
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Что делаем?</h1>
      {active && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {activeSummaryText(active)}{' '}
          {active.words === 0 && (
            <Link to="/dictionaries" className="text-blue-600 underline dark:text-blue-400">
              Выбрать словари
            </Link>
          )}
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {MODES.map(({ to, title, hint, Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex h-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-400 active:bg-blue-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800"
            >
              <span className="rounded-xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                <Icon className="size-7" />
              </span>
              <span>
                <span className="block text-lg font-medium">{title}</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">{hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
