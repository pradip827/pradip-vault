/**
 * URL and input sanitization utilities for ZeroVault.
 * Defends against XSS, javascript: URI injection, and malicious redirects.
 */

const DANGEROUS_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:'];

/**
 * Checks if a string contains any dangerous URI schemes, even with whitespace or mixed casing.
 */
export function containsDangerousScheme(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;

  // Remove control characters and whitespace that attackers use to bypass scheme checks
  // e.g. "java\nscript:alert(1)" or "jav&#x09;ascript:"
  const sanitized = rawUrl.replace(/[\x00-\x20\s]/g, '').toLowerCase();

  return DANGEROUS_SCHEMES.some(scheme => sanitized.startsWith(scheme));
}

/**
 * Validates whether a URL is a safe web destination (http: or https: only).
 */
export function isValidWebUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;

  const trimmed = rawUrl.trim();
  if (!trimmed || containsDangerousScheme(trimmed)) return false;

  try {
    // If no protocol is specified, check with https:// prepended
    const urlToTest = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

    const parsed = new URL(urlToTest);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalizes a URL for safe storage and navigation:
 * - Rejects dangerous schemes and returns an empty string.
 * - Auto-prefixes 'https://' if no scheme was specified by the user.
 * - Enforces http: or https: protocols.
 */
export function sanitizeWebUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  const trimmed = rawUrl.trim();
  if (!trimmed || containsDangerousScheme(trimmed)) return '';

  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
    const urlToParse = hasScheme ? trimmed : `https://${trimmed}`;

    const parsed = new URL(urlToParse);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Returns safe anchor attributes for external navigation.
 * Enforces noopener and noreferrer to prevent window.opener hijacking and credential leakage.
 */
export function getSafeExternalLinkProps(): { rel: string; target: string } {
  return {
    rel: 'noopener noreferrer',
    target: '_blank'
  };
}

/**
 * Strips non-printable and control characters (excluding newline and tab) from user input.
 */
export function sanitizeDisplayText(text: string): string {
  if (!text || typeof text !== 'string') return '';
  // Keep regular printable characters, unicode, spaces, newlines (\n, \r), and tabs (\t)
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}
