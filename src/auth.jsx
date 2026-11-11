import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch, clearSession, readSession, saveSession } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession);

  const login = useCallback((data) => {
    const next = { token: data.token, user: data.user };
    saveSession(next);
    setSession(next);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const updateUser = useCallback((user, token) => {
    setSession((current) => {
      if (!current) return current;
      const next = { token: token || current.token, user: { ...current.user, ...user } };
      saveSession(next);
      return next;
    });
  }, []);

  // A 401 from any request means the token is no longer valid.
  useEffect(() => {
    const onUnauthorized = () => setSession(null);
    window.addEventListener('mh:unauthorized', onUnauthorized);
    return () => window.removeEventListener('mh:unauthorized', onUnauthorized);
  }, []);

  // Refresh the stored user once on load (picks up role/ban/NID changes).
  const hasToken = Boolean(session?.token);
  useEffect(() => {
    if (!hasToken) return;

    let cancelled = false;
    apiFetch('/me')
      .then((data) => {
        if (!cancelled) updateUser(data.user);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [hasToken, updateUser]);

  const value = useMemo(
    () => ({ user: session?.user || null, login, logout, updateUser }),
    [session, login, logout, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
