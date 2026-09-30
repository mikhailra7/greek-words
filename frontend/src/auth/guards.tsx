import { Navigate, Outlet, useLocation } from 'react-router'
import { Spinner } from '../components/ui.tsx'
import { useAuth } from './AuthContext.tsx'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function RequireAdmin() {
  const { user } = useAuth()
  if (!user?.is_admin) return <Navigate to="/" replace />
  return <Outlet />
}

// Login/register pages: a signed-in user has nothing to do there.
export function GuestOnly() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (user) return <Navigate to="/" replace />
  return <Outlet />
}
