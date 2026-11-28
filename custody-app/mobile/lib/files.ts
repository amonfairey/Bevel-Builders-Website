// Upload helpers for receipts and note attachments (pure: no React Native imports, unit-tested).

/** File types the server stores (POST /api/expenses `receipt`, POST /api/notes `attachment`). */
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'application/pdf'] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];

const EXT: Record<UploadType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode the first `n` bytes of a base64 string (tolerates a data: URI prefix and whitespace). */
export function base64Head(b64: string, n = 16): number[] {
  const s = b64.replace(/^data:[^,]*,/, '').replace(/[^A-Za-z0-9+/]/g, '').slice(0, Math.ceil(n / 3) * 4);
  const out: number[] = [];
  for (let i = 0; i + 1 < s.length && out.length < n; i += 4) {
    const a = B64.indexOf(s[i]), b = B64.indexOf(s[i + 1]);
    const c = i + 2 < s.length ? B64.indexOf(s[i + 2]) : -1;
    const d = i + 3 < s.length ? B64.indexOf(s[i + 3]) : -1;
    out.push((a << 2) | (b >> 4));
    if (c >= 0) out.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) out.push(((c & 3) << 6) | d);
  }
  return out.slice(0, n);
}

const ascii = (bytes: number[], from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/**
 * The real type of base64 file data from its leading bytes, or null when it is not one of
 * the types the server accepts (e.g. BMP, TIFF, AVIF, SVG).
 */
export function sniffUploadType(b64: string): UploadType | null {
  const h = base64Head(b64, 16);
  if (h.length < 4) return null;
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg';
  if (h[0] === 0x89 && ascii(h, 1, 4) === 'PNG') return 'image/png';
  if (ascii(h, 0, 4) === 'GIF8') return 'image/gif';
  if (ascii(h, 0, 4) === 'RIFF' && ascii(h, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(h, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(h, 8, 12))) return 'image/heic';
  if (ascii(h, 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/** Normalize a MIME type to an accepted upload type ('image/jpg' -> 'image/jpeg', 'image/heif' -> 'image/heic'), or null. */
export function acceptedType(mime: string | null | undefined): UploadType | null {
  const m = String(mime ?? '').toLowerCase().split(';')[0].trim();
  if (m === 'image/jpg' || m === 'image/pjpeg') return 'image/jpeg';
  if (m === 'image/heif') return 'image/heic';
  return (UPLOAD_TYPES as readonly string[]).includes(m) ? (m as UploadType) : null;
}

/** File name with the extension that matches `type` ('IMG_1.HEIC' + image/jpeg -> 'IMG_1.jpg'). */
export function fileNameFor(name: string | null | undefined, type: UploadType, fallbackBase = 'photo'): string {
  const base = String(name ?? '').trim().replace(/\.[^./\\]+$/, '') || fallbackBase;
  return `${base}.${EXT[type]}`;
}
