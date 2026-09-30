import type { ReactNode } from 'react'

export default function PageStub({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section>
      <h1 className="mb-3 text-2xl font-semibold">{title}</h1>
      <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-slate-500 dark:border-slate-700 dark:text-slate-400">
        {children ?? 'Раздел в разработке.'}
      </div>
    </section>
  )
}
