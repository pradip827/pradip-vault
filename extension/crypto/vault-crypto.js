/**
 * ZeroVault Extension Cryptographic Module
 * Client-Side Authenticated Encryption (AES-256-GCM)
 */

export function encodeBase64Url(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeBase64Url(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function deriveKeyPbkdf2(password, saltBytes, iterations = 100000) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPayload(plaintextUtf8, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyPbkdf2(password, salt);

  const ciphertextWithTag = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: 128
    },
    key,
    enc.encode(plaintextUtf8)
  );

  return {
    formatVersion: 1,
    kdf: {
      algorithm: 'PBKDF2',
      iterations: 100000,
      salt: encodeBase64Url(salt)
    },
    encryption: {
      cipher: 'AES-256-GCM',
      iv: encodeBase64Url(iv),
      tagLength: 128
    },
    ciphertext: encodeBase64Url(new Uint8Array(ciphertextWithTag))
  };
}

export async function decryptPayload(envelope, password) {
  if (!envelope || !envelope.ciphertext) {
    throw new Error('Malformed vault envelope');
  }

  const salt = decodeBase64Url(envelope.kdf.salt);
  const iv = decodeBase64Url(envelope.encryption.iv);
  const ciphertextWithTag = decodeBase64Url(envelope.ciphertext);
  const iterations = envelope.kdf.iterations || 100000;

  const key = await deriveKeyPbkdf2(password, salt, iterations);

  const decryptedBytes = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: 128
    },
    key,
    ciphertextWithTag
  );

  const dec = new TextDecoder();
  return dec.decode(decryptedBytes);
}

export async function loadStoredEnvelope() {
  const res = await chrome.storage.local.get('zerovault_envelope');
  return res.zerovault_envelope || null;
}

export async function saveStoredEnvelope(envelope) {
  await chrome.storage.local.set({ zerovault_envelope: envelope });
}
