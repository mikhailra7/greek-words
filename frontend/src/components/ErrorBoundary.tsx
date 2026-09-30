import { Component, type ErrorInfo, type ReactNode } from 'react'

// Last line of defence: a bug in one screen shows a message instead of a blank page.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }

  static getDerivedStateFromError() {
    return { error: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-4xl">😕</p>
        <p className="text-lg font-medium">Что-то пошло не так</p>
        <p className="text-sm text-slate-500">
          Обновите страницу. Если повторится — напишите админу.
        </p>
        <button
          onClick={() => window.location.assign('/')}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white"
        >
          На главную
        </button>
      </div>
    )
  }
}
