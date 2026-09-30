import type { ReactNode } from 'react'
import { Card } from './ui.tsx'

export default function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-start justify-center px-4 pt-[12vh] pb-8">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-center text-3xl font-semibold tracking-tight">Λέξεις</p>
        <p className="mb-6 text-center text-sm text-slate-500">греческие слова для нашей группы</p>
        <Card className="p-6">
          <h1 className="mb-4 text-xl font-semibold">{title}</h1>
          {children}
        </Card>
      </div>
    </div>
  )
}
