// Push sender for the iPhone app, via the Expo push service (which relays to APNs).
// Never throws: a push failure must not affect the API request that caused it.

export const DEFAULT_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const PUSH_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;
const BATCH = 100; // Expo accepts at most 100 messages per request

/**
 * @param db        node:sqlite database (used to drop tokens Expo reports as DeviceNotRegistered)
 * @param url       push endpoint (env PUSH_URL; a local mock in tests)
 * @param disabled  env PUSH_DISABLED=1
 * @param accessToken optional Expo access token (only needed if "enhanced push security" is on in the Expo project)
 */
export function createPush(db, { url = DEFAULT_PUSH_URL, disabled = false, accessToken = null, timeoutMs = 10000, logger = console } = {}) {
  const dropToken = (t) => { try { db.prepare('DELETE FROM push_tokens WHERE token = ?').run(t); } catch (e) { logger.error('push: could not remove token', e.message); } };

  /** messages: [{to, title, body, sound, badge, data}] */
  async function send(messages) {
    if (disabled || !messages.length) return;
    for (let i = 0; i < messages.length; i += BATCH) {
      const chunk = messages.slice(i, i + BATCH);
      try {
        const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(chunk), signal: AbortSignal.timeout(timeoutMs) });
        const json = await res.json().catch(() => null);
        if (!res.ok) { logger.error(`push: service returned ${res.status}`, JSON.stringify(json?.errors ?? '').slice(0, 300)); continue; }
        const tickets = Array.isArray(json?.data) ? json.data : [];
        tickets.forEach((ticket, k) => {
          if (ticket?.status !== 'error') return;
          if (ticket.details?.error === 'DeviceNotRegistered' && chunk[k]) dropToken(chunk[k].to);
          else logger.error('push: ticket error', ticket.details?.error || ticket.message || 'unknown');
        });
      } catch (e) {
        logger.error('push: send failed', e.message);
      }
    }
  }
  return { send, enabled: !disabled };
}
