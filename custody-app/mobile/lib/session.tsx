import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage, setAuthToken, setUnauthorizedHandler } from './api';
import { unregisterPush } from './push';
import { getItem, KEYS, removeItem, setItem } from './storage';
import type { Me, MeNoFamily, MeResponse, TokenResponse } from './types';

/**
 * Session state for the whole app.
 *
 *   loading     - reading the stored token / first /api/me (bootError set if the server is unreachable)
 *   signedOut   - no valid token: show (auth)/sign-in
 *   needsFamily - signed in, not in a family yet: show /setup
 *   ready       - signed in with a family: show the tabs
 */
export type SessionStatus = 'loading' | 'signedOut' | 'needsFamily' | 'ready';

export interface SessionValue {
  status: SessionStatus;
  /** Me when ready, MeNoFamily when needsFamily, null otherwise */
  me: Me | MeNoFamily | null;
  /** set while status is 'loading' and the first /api/me failed (offline, server down) */
  bootError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Forget the session on this device without calling the server (e.g. right after POST /api/account/delete). */
  signOutLocally: () => Promise<void>;
  /** Re-fetch /api/me (after joining a family, renaming a child, reading notifications...). */
  refreshMe: () => Promise<Me | MeNoFamily | null>;
}

const SessionContext = createContext<SessionValue | null>(null);

function statusOf(me: MeResponse | null): SessionStatus {
  if (!me || !me.user) return 'signedOut';
  return me.family ? 'ready' : 'needsFamily';
}

const MOBILE_ONLY_MSG = 'This server does not support the iPhone app yet (no token returned). Update the CoParent Hub server.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [me, setMe] = useState<Me | MeNoFamily | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const meJson = useRef('');
  const statusRef = useRef<SessionStatus>('loading');
  statusRef.current = status;

  const apply = useCallback((next: MeResponse | null) => {
    const signedIn = next && next.user ? (next as Me | MeNoFamily) : null;
    const json = JSON.stringify(signedIn);
    if (json !== meJson.current) { meJson.current = json; setMe(signedIn); }
    setStatus(statusOf(next));
    return signedIn;
  }, []);

  const clearLocal = useCallback(async () => {
    setAuthToken(null);
    await removeItem(KEYS.session);
    apply(null);
  }, [apply]);

  const refreshMe = useCallback(async () => {
    try {
      const next = await api.get<MeResponse>('/api/me');
      setBootError(null);
      return apply(next);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await clearLocal(); return null; }
      // Keep the current state on network errors; surface them only while booting.
      if (statusRef.current === 'loading') setBootError(errorMessage(e));
      throw e;
    }
  }, [apply, clearLocal]);

  // Boot: restore the stored token, then load /api/me.
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await getItem(KEYS.session);
      if (!alive) return;
      if (!token) { apply(null); return; }
      setAuthToken(token);
      try { await refreshMe(); } catch { /* bootError is set; the layout offers Retry */ }
    })();
    return () => { alive = false; };
  }, [apply, refreshMe]);

  // Any 401 on an authenticated request signs out locally (no network calls, so no loops).
  useEffect(() => {
    setUnauthorizedHandler(() => { void clearLocal(); });
    return () => setUnauthorizedHandler(null);
  }, [clearLocal]);

  const startSession = useCallback(async (res: TokenResponse | { ok: true; token?: string }) => {
    if (!res || typeof res.token !== 'string' || !res.token) throw new ApiError(500, MOBILE_ONLY_MSG);
    setAuthToken(res.token);
    await setItem(KEYS.session, res.token);
    await refreshMe();
  }, [refreshMe]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.post<TokenResponse>('/api/login', { email: email.trim(), password, client: 'mobile' });
    await startSession(res);
  }, [startSession]);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const res = await api.post<TokenResponse>('/api/register', { name: name.trim(), email: email.trim(), password, client: 'mobile' });
    await startSession(res);
  }, [startSession]);

  const signOut = useCallback(async () => {
    await unregisterPush();
    try { await api.post('/api/logout'); } catch { /* already invalid: fine */ }
    await clearLocal();
  }, [clearLocal]);

  const signOutLocally = useCallback(async () => {
    await removeItem(KEYS.pushToken);
    await clearLocal();
  }, [clearLocal]);

  const value = useMemo<SessionValue>(() => ({ status, me, bootError, signIn, signUp, signOut, signOutLocally, refreshMe }),
    [status, me, bootError, signIn, signUp, signOut, signOutLocally, refreshMe]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside <AuthProvider>');
  return v;
}
