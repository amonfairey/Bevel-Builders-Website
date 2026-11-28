import { API_URL } from './config';

/**
 * Tiny typed client for the CoParent Hub API.
 *
 *   const me = await api.get<Me>('/api/me');
 *   const { id } = await api.post<IdResponse>('/api/threads', { subject, topic, body });
 *
 * - Sends JSON and `Authorization: Bearer <token>` (native clients do not use cookies).
 * - Throws ApiError { status, message } with the server's `{ error }` text. status 0 = network error.
 * - On 401 it calls the registered unauthorized handler (the session signs out locally),
 *   except for /api/login and /api/register where 401 just means "wrong password".
 */

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Human-readable message for anything thrown by an API call (or any other error). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'Something went wrong';
}

let authToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

/** Set (or clear) the bearer token sent with every request. Called by the session. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** Register what happens on a 401 (the session clears itself). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

const NO_SIGNOUT_PATHS = ['/api/login', '/api/register'];
const TIMEOUT_MS = 30000;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const url = /^https?:\/\//i.test(path) ? path : `${API_URL}${path}`;
  const tokenAtStart = authToken;
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: string | undefined;
  if (method === 'POST' || method === 'PUT') {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body ?? {});
  }
  if (tokenAtStart) headers.Authorization = `Bearer ${tokenAtStart}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, signal: controller.signal, credentials: 'omit' });
  } catch (e) {
    const host = API_URL.replace(/^https?:\/\//, '');
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new ApiError(0, aborted ? `The server at ${host} took too long to answer.` : `Can't reach the server at ${host}. Check your connection.`);
  } finally {
    clearTimeout(timer);
  }

  const type = res.headers.get('content-type') || '';
  let data: unknown = null;
  try {
    data = type.includes('json') ? await res.json() : await res.text();
  } catch {
    data = null;
  }

  if (res.status === 401 && tokenAtStart && tokenAtStart === authToken && !NO_SIGNOUT_PATHS.some((p) => path.startsWith(p))) {
    unauthorizedHandler?.();
  }
  if (!res.ok) {
    const msg = data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
      ? (data as { error: string }).error
      : typeof data === 'string' && data && data.length < 200 ? data : `Error ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/**
 * Fetch a binary file the API serves (e.g. /api/files/<hash>) with the bearer token and
 * return it as a data: URI plus its content type. Used to show attachments in-app, since
 * Safari / an <Image> URL cannot carry the token.
 */
export async function fetchDataUri(path: string): Promise<{ uri: string; type: string }> {
  const url = /^https?:\/\//i.test(path) ? path : `${API_URL}${path}`;
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetch(url, { headers, credentials: 'omit' });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'File not found' : `Error ${res.status}`);
  const blob = await res.blob();
  const type = res.headers.get('content-type') || blob.type || 'application/octet-stream';
  const uri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ApiError(0, 'Could not read the file'));
    reader.readAsDataURL(blob);
  });
  return { uri, type };
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Build a query string from defined values: qs({ start, end }) -> '?start=..&end=..' */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
