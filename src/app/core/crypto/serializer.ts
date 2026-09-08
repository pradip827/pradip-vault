import { EnvelopeHeader } from './crypto.types';

/**
 * Encodes a Uint8Array into a binary-safe base64url string (RFC 4648 §5).
 * Replaces '+' with '-', '/' with '_', and removes padding '='.
 */
export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a base64url string (RFC 4648 §5) into a Uint8Array.
 * Restores padding and replaces '-' with '+', '_' with '/'.
 */
export function decodeBase64Url(base64url: string): Uint8Array {
  if (typeof base64url !== 'string') {
    throw new Error('Invalid base64url input: expected string.');
  }

  // Restore standard base64 characters
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');

  // Add required padding '='
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  // Validate base64 structure
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('Malformed base64url string.');
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Serializes a JavaScript value to canonical, deterministic JSON (RFC 8785 JCS subset).
 * - Object keys are sorted lexicographically by UTF-16 code units.
 * - Whitespace is completely omitted.
 * - Guarantees exact bit-for-bit identical byte output across all platforms.
 */
export function serializeCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(item => serializeCanonicalJson(item));
    return `[${items.join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(key => {
    const val = obj[key];
    if (val === undefined) return null;
    return `${JSON.stringify(key)}:${serializeCanonicalJson(val)}`;
  }).filter((p): p is string => p !== null);

  return `{${pairs.join(',')}}`;
}

/**
 * Builds the canonical Additional Authenticated Data (AAD) byte buffer for an envelope.
 * Binds formatVersion, kdf, and encryption metadata to the AES-256-GCM authentication tag.
 */
export function constructEnvelopeAAD(header: EnvelopeHeader): Uint8Array {
  const canonicalData = {
    formatVersion: header.formatVersion,
    kdf: {
      algorithm: header.kdf.algorithm,
      params: {
        memory: header.kdf.params.memory,
        iterations: header.kdf.params.iterations,
        parallelism: header.kdf.params.parallelism,
        keyLength: header.kdf.params.keyLength
      },
      salt: header.kdf.salt
    },
    encryption: {
      cipher: header.encryption.cipher,
      iv: header.encryption.iv,
      tagLength: header.encryption.tagLength
    }
  };

  const canonicalString = serializeCanonicalJson(canonicalData);
  return new TextEncoder().encode(canonicalString);
}

/**
 * Computes a standard SHA-256 cryptographic digest and returns the lowercase hex string.
 * Supports string (encoded as UTF-8) or Uint8Array.
 */
export async function computeSha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
