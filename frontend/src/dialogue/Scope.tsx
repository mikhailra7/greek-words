import type { ReactNode } from 'react'
import { Button } from '../components/ui.tsx'

// «Сборка фразы» / «Ввод по памяти»: what to practise — every line, or one role's lines (then
// the others are context: shown and played on their own). null = all lines.
export type Scope = number | null

export function ScopeSetup({
  speakers,
  scope,
  onScope,
  onStart,
  children,
}: {
  speakers: string[]
  scope: Scope
  onScope: (scope: Scope) => void
  onStart: () => void
  children?: ReactNode
}) {
  const options: [Scope, string][] = [
    [null, 'Все реплики'],
    ...speakers.map((s, i): [Scope, string] => [i, s]),
  ]
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 font-medium">Какие реплики</p>
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          role="radiogroup"
          aria-label="Какие реплики"
        >
          {options.map(([value, label]) => (
            <button
              key={String(value)}
              role="radio"
              aria-checked={scope === value}
              onClick={() => onScope(value)}
              lang={value === null ? undefined : 'el'}
              className={`rounded-xl border-2 px-3 py-2.5 text-sm ${
                scope === value
                  ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {children}
      <Button onClick={onStart} className="w-full py-3 text-base">
        Начать
      </Button>
    </div>
  )
}
