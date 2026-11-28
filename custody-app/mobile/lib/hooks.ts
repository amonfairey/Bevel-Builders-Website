import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from './api';
import { useSession } from './session';
import type { Child, Me, Member } from './types';

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | null;
  /** true until the first response (or error) for the current path */
  loading: boolean;
  /** true while a pull-to-refresh is running */
  refreshing: boolean;
  /** refetch, showing the loading state only if there is no data yet */
  reload: () => Promise<void>;
  /** refetch for pull-to-refresh (sets `refreshing`) */
  refresh: () => Promise<void>;
  /** replace the data locally (optimistic updates) */
  setData: (d: T | undefined) => void;
}

/**
 * GET `path` and keep it fresh: loads on mount, refetches silently every time the screen
 * regains focus (coming back from a detail screen) and when `path` or `deps` change.
 * Pass `null` to skip fetching (e.g. until a param is known).
 *
 *   const { data, error, loading, refreshing, refresh, reload } = useApi<Dashboard>('/api/dashboard');
 */
export function useApi<T>(path: string | null, deps: DependencyList = []): ApiState<T> {
  // Data is stored with the path it belongs to, so a screen never shows another item's content.
  const [state, setState] = useState<{ path: string | null; data: T | undefined }>({ path, data: undefined });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(path != null);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const mounted = useRef(true);
  const current = useRef(state);
  current.current = state;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    if (path == null) { setLoading(false); return; }
    const mine = ++seq.current;
    const has = current.current.path === path && current.current.data !== undefined;
    if (mode === 'refresh') setRefreshing(true);
    else if (mode === 'initial' || !has) { setLoading(true); setError(null); }
    try {
      const d = await api.get<T>(path);
      if (!mounted.current || mine !== seq.current) return;
      setState({ path, data: d });
      setError(null);
    } catch (e) {
      if (!mounted.current || mine !== seq.current) return;
      setError(e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : 'Something went wrong'));
    } finally {
      if (mounted.current && mine === seq.current) { setLoading(false); setRefreshing(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useFocusEffect(useCallback(() => {
    const has = current.current.path === path && current.current.data !== undefined;
    void load(has ? 'silent' : 'initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]));

  const reload = useCallback(() => load('silent'), [load]);
  const refresh = useCallback(() => load('refresh'), [load]);
  const setData = useCallback((d: T | undefined) => setState({ path, data: d }), [path]);
  const data = state.path === path ? state.data : undefined;
  return { data, error, loading: loading || (path != null && data === undefined && !error), refreshing, reload, refresh, setData };
}

/** Last Me seen while ready, so screens that are unmounting after sign-out don't crash. */
let lastReadyMe: Me | null = null;

/**
 * The signed-in user's Me (family, members, children...). Use in screens behind the auth
 * gate (status 'ready'). While a screen is being torn down after sign-out or leaving the
 * family it returns the last known Me instead of throwing.
 */
export function useMe(): Me {
  const { me, status } = useSession();
  if (status === 'ready' && me && me.family) {
    lastReadyMe = me as Me;
    return me as Me;
  }
  if (lastReadyMe) return lastReadyMe;
  throw new Error('useMe() used outside a signed-in family screen');
}

// ---------- people helpers (pure; take `me`) ----------

export const member = (me: Me, id: number | null | undefined): Member | undefined => me.members.find((m) => m.id === id);
/** Display name, 'Unassigned' for null/unknown. */
export const nameOf = (me: Me, id: number | null | undefined): string => member(me, id)?.name || 'Unassigned';
/** 'You' for the signed-in user, otherwise the name. */
export const youOr = (me: Me, id: number | null | undefined): string => (id === me.user.id ? 'You' : nameOf(me, id));
/** Member color; grey for null/unknown. */
export const colorOf = (me: Me, id: number | null | undefined): string => member(me, id)?.color || '#9aa4ab';
export const parents = (me: Me): Member[] => me.members.filter((m) => m.role === 'parent');
/** The co-parent, if they have joined. */
export const otherParent = (me: Me): Member | undefined => parents(me).find((p) => p.id !== me.user.id);
export const isParent = (me: Me): boolean => me.role === 'parent';
export const childNames = (me: Me, ids: number[] | null | undefined): string =>
  (ids || []).map((id) => me.children.find((c) => c.id === id)?.name).filter(Boolean).join(', ');
export const childById = (me: Me, id: number): Child | undefined => me.children.find((c) => c.id === id);
/** Options for a parent Select: '(you)' appended to the signed-in user. */
export const parentOptions = (me: Me): { value: number; label: string }[] =>
  parents(me).map((p) => ({ value: p.id, label: p.id === me.user.id ? `${p.name} (you)` : p.name }));

/**
 * The helpers above bound to the current `me`:
 *   const { me, tz, nameOf, colorOf, other, isParent } = usePeople();
 */
export function usePeople() {
  const me = useMe();
  return {
    me,
    /** family time zone: pass to every lib/format function */
    tz: me.family.timezone,
    myId: me.user.id,
    nameOf: (id: number | null | undefined) => nameOf(me, id),
    youOr: (id: number | null | undefined) => youOr(me, id),
    colorOf: (id: number | null | undefined) => colorOf(me, id),
    parents: parents(me),
    other: otherParent(me),
    isParent: isParent(me),
    childNames: (ids: number[] | null | undefined) => childNames(me, ids),
    parentOptions: parentOptions(me),
  };
}
