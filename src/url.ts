import { createHash } from 'node:crypto';

/**
 * Canonicalise a URL so trivially-different strings (trailing slash, `www.`
 * prefix, default port, scheme/host case) land on the same beach.
 *
 *   https://Example.com/        → https://example.com
 *   https://www.example.com/    → https://example.com
 *   https://example.com:443/a/  → https://example.com/a
 *   HTTPS://example.com/Path    → https://example.com/path
 *
 * Path is lowercased too for consistency — matches the pre-normalisation
 * behaviour where the whole URL was `toLowerCase()`d, so existing buckets
 * for all-lowercase paths are preserved. Query string is kept (meaningful
 * for content); fragment is dropped.
 *
 * Falls back to trim().toLowerCase() for strings that don't parse as URLs.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  try {
    const u = new URL(trimmed);
    const scheme = u.protocol.toLowerCase();
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    const isDefaultPort =
      (scheme === 'http:' && u.port === '80') ||
      (scheme === 'https:' && u.port === '443');
    const port = u.port && !isDefaultPort ? `:${u.port}` : '';
    let pathname = u.pathname.toLowerCase();
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `${scheme}//${host}${port}${pathname}${u.search.toLowerCase()}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * SHA-256 hash of the normalised URL, truncated to 16 chars. The `url_hash`
 * column in `beach_marks` and `pool_state` is keyed on this.
 */
export function hashUrl(url: string): string {
  return createHash('sha256').update(normalizeUrl(url)).digest('hex').slice(0, 16);
}

/** Parse a URL into `{domain, path}` for `.well-known` lookups. */
export function parseBeachUrl(url: string): { domain: string; path: string } {
  const canonical = normalizeUrl(url);
  try {
    const u = new URL(canonical);
    return { domain: `${u.protocol}//${u.host}`, path: u.pathname || '/' };
  } catch {
    return { domain: canonical, path: '/' };
  }
}
