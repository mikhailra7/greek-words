import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client.ts'
import { useAuth } from '../auth/AuthContext.tsx'
import { Button, Card, ErrorText, Field, Input, Spinner } from '../components/ui.tsx'

type AdminUser = {
  id: number
  username: string
  is_admin: boolean
  created_at: string
  last_login_at: string | null
}

type Invite = {
  id: number
  code: string
  max_uses: number | null
  used_count: number
  expires_at: string | null
  is_active: boolean
  created_at: string
  usable: boolean
}

// Server stores naive UTC.
const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso.endsWith('Z') ? iso : `${iso}Z`).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

export default function AdminPage() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Администрирование</h1>
      <Users />
      <Invites />
    </section>
  )
}

function Users() {
  const { user: me, refresh } = useAuth()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [maxUsers, setMaxUsers] = useState(0)
  const [error, setError] = useState('')
  const [tempPassword, setTempPassword] = useState<{ username: string; password: string } | null>(
    null,
  )

  const load = useCallback(async () => {
    const data = await api<{ users: AdminUser[]; max_users: number }>('/admin/users')
    setUsers(data.users)
    setMaxUsers(data.max_users)
  }, [])

  useEffect(() => {
    load().catch((e: Error) => setError(e.message))
  }, [load])

  const run = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const toggleAdmin = (u: AdminUser) =>
    run(async () => {
      await api(`/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_admin: !u.is_admin }),
      })
      if (u.id === me?.id) await refresh() // demoted myself → lose admin UI
    })

  const resetPassword = (u: AdminUser) => {
    if (!confirm(`Сбросить пароль пользователю ${u.username}?`)) return
    run(async () => {
      const r = await api<{ password: string }>(`/admin/users/${u.id}/reset-password`, {
        method: 'POST',
      })
      setTempPassword({ username: u.username, password: r.password })
    })
  }

  const remove = (u: AdminUser) => {
    if (!confirm(`Удалить пользователя ${u.username}? Это нельзя отменить.`)) return
    run(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }))
  }

  if (!users) return error ? <ErrorText>{error}</ErrorText> : <Spinner />

  return (
    <div>
      <h2 className="mb-2 text-lg font-medium">
        Пользователи{' '}
        <span className="text-slate-500">
          {users.length} / {maxUsers}
        </span>
      </h2>
      <ErrorText>{error}</ErrorText>
      {tempPassword && (
        <Card className="mb-3 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-sm">
            Новый пароль для <b>{tempPassword.username}</b> (покажется один раз):
          </p>
          <p className="my-2 font-mono text-lg select-all">{tempPassword.password}</p>
          <Button variant="ghost" onClick={() => setTempPassword(null)}>
            Скрыть
          </Button>
        </Card>
      )}
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id}>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {u.username}
                    {u.id === me?.id && <span className="text-slate-500"> (вы)</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    с {fmtDate(u.created_at)} · вход {fmtDate(u.last_login_at)}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-blue-600"
                    checked={u.is_admin}
                    onChange={() => toggleAdmin(u)}
                  />
                  админ
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => resetPassword(u)}>
                  Сбросить пароль
                </Button>
                {u.id !== me?.id && (
                  <Button variant="dangerGhost" onClick={() => remove(u)}>
                    Удалить
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Invites() {
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [maxUses, setMaxUses] = useState('')
  const [days, setDays] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<number | null>(null)

  const load = useCallback(async () => setInvites(await api<Invite[]>('/admin/invites')), [])

  useEffect(() => {
    load().catch((e: Error) => setError(e.message))
  }, [load])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api('/admin/invites', {
        method: 'POST',
        body: JSON.stringify({
          max_uses: maxUses ? Number(maxUses) : null,
          expires_in_days: days ? Number(days) : null,
        }),
      })
      setMaxUses('')
      setDays('')
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const toggle = async (inv: Invite) => {
    setError('')
    try {
      await api(`/admin/invites/${inv.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !inv.is_active }),
      })
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const copy = async (inv: Invite) => {
    await navigator.clipboard.writeText(inv.code)
    setCopied(inv.id)
    setTimeout(() => setCopied(null), 1500)
  }

  const status = (inv: Invite) => {
    if (!inv.is_active) return 'отключён'
    if (inv.usable) return 'действует'
    if (inv.max_uses !== null && inv.used_count >= inv.max_uses) return 'исчерпан'
    return 'истёк'
  }

  return (
    <div>
      <h2 className="mb-2 text-lg font-medium">Коды приглашения</h2>
      <Card className="mb-3">
        <form onSubmit={create} className="grid grid-cols-2 gap-3">
          <Field label="Сколько раз" hint="пусто = без лимита">
            <Input
              type="number"
              min={1}
              max={1000}
              inputMode="numeric"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </Field>
          <Field label="Дней действует" hint="пусто = бессрочно">
            <Input
              type="number"
              min={1}
              max={365}
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
          <Button type="submit" className="col-span-2">
            Создать код
          </Button>
        </form>
      </Card>
      <ErrorText>{error}</ErrorText>
      {!invites ? (
        <Spinner />
      ) : invites.length === 0 ? (
        <p className="text-sm text-slate-500">Кодов пока нет.</p>
      ) : (
        <ul className="space-y-2">
          {invites.map((inv) => (
            <li key={inv.id}>
              <Card className={inv.usable ? '' : 'opacity-60'}>
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => copy(inv)}
                    className="font-mono text-lg tracking-wider"
                    title="Скопировать"
                  >
                    {inv.code}
                  </button>
                  <span className="text-sm text-slate-500">
                    {copied === inv.id ? 'скопировано' : status(inv)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  использован {inv.used_count}
                  {inv.max_uses !== null ? ` из ${inv.max_uses}` : ''} ·{' '}
                  {inv.expires_at ? `до ${fmtDate(inv.expires_at)}` : 'бессрочно'}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" onClick={() => copy(inv)}>
                    Скопировать
                  </Button>
                  <Button variant="ghost" onClick={() => toggle(inv)}>
                    {inv.is_active ? 'Отключить' : 'Включить'}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
