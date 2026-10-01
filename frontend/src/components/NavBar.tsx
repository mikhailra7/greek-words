import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import {
  IconBook,
  IconCards,
  IconChat,
  IconHeadphones,
  IconMenu,
  IconPencil,
  IconShuffle,
  IconSwap,
  IconUser,
} from './icons.tsx'

const items = [
  { to: '/dictionaries', label: 'Словари', Icon: IconBook },
  { to: '/study', label: 'Изучение слов', short: 'Изучение', Icon: IconCards },
  { to: '/translate', label: 'Переведи слово', short: 'Переведи', Icon: IconSwap },
  { to: '/write', label: 'Напиши', Icon: IconPencil },
  { to: '/mix', label: 'Микс заданий', short: 'Микс', Icon: IconShuffle },
  { to: '/listen', label: 'Аудио повторение', short: 'Аудио', Icon: IconHeadphones },
  { to: '/dialogues', label: 'Диалоги', Icon: IconChat },
  { to: '/profile', label: 'Профиль', Icon: IconUser },
]

const linkColor = (active: boolean) =>
  active
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100'

export default function NavBar() {
  return (
    <>
      <MobileNav />
      <DesktopNav />
    </>
  )
}

// Laptop: one row of links on top — there is room for all of them.
function DesktopNav() {
  return (
    <nav className="sticky top-0 z-10 hidden border-b border-slate-200 bg-white/95 backdrop-blur md:block dark:border-slate-800 dark:bg-slate-900/95">
      <ul className="mx-auto flex max-w-5xl flex-wrap justify-center gap-x-1">
        <li>
          <Link
            to="/"
            className="flex items-center px-3 py-3 text-sm font-semibold"
            title="Главная"
          >
            Λέξεις
          </Link>
        </li>
        {items.map(({ to, label, short, Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-3 text-sm ${linkColor(isActive)}`
              }
            >
              <Icon className="size-5" />
              {short ?? label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// Phone: a slim header with ☰; the menu slides in from the left and closes on a tap
// outside, on ✕, on Esc or with the phone's «Back».
function MobileNav() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const current = items.find((i) => location.pathname.startsWith(i.to))

  const show = () => {
    // A history entry for the open menu, so «Back» closes it instead of leaving the page.
    window.history.pushState({ ...window.history.state, menu: true }, '')
    setOpen(true)
  }
  const hide = useCallback(() => window.history.back(), []) // → popstate → closed

  useEffect(() => {
    if (!open) return
    const onPop = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, hide])

  const go = (e: MouseEvent, to: string) => {
    e.preventDefault()
    setOpen(false)
    // Replaces the menu's history entry, so «Back» later returns to the previous page.
    navigate(to, { replace: true })
  }

  return (
    <div className="md:hidden">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <button
          onClick={show}
          className="rounded-xl p-2.5 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          aria-label="Открыть меню"
          aria-expanded={open}
        >
          <IconMenu className="size-7" />
        </button>
        <Link to="/" className="font-semibold">
          Λέξεις
        </Link>
        {current && (
          <span className="truncate text-slate-500">· {current.short ?? current.label}</span>
        )}
      </header>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Меню">
          <div className="absolute inset-0 bg-black/40" onClick={hide} aria-hidden="true" />
          <nav className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white pt-[env(safe-area-inset-top)] shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xl font-semibold">Λέξεις</span>
              <button
                onClick={hide}
                className="-mr-2 rounded-full p-2 text-2xl leading-none text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Закрыть меню"
              >
                ×
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto px-2 pb-4">
              {items.map(({ to, label, Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    onClick={(e) => go(e, to)}
                    className={({ isActive }) =>
                      `flex items-center gap-4 rounded-xl px-3 py-3.5 text-lg ${linkColor(isActive)} ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-950'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`
                    }
                  >
                    <Icon className="size-6" />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </div>
  )
}
