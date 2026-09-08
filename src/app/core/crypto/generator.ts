/**
 * Cryptographically Secure Unbiased Password & Passphrase Generator.
 *
 * Implements:
 * 1. Strict rejection sampling eliminating modulo bias (via entropy.ts).
 * 2. Guaranteed inclusion of at least one character from each selected charset.
 * 3. Uniform permutation via CSPRNG Fisher-Yates shuffle.
 * 4. Diceware passphrase mode using the 2,048-word BIP-39 wordlist.
 * 5. Shannon entropy calculation and strength classification.
 */

import { getUnbiasedRandomChar, secureShuffle } from './entropy';
import { BIP39_ENGLISH_WORDLIST, BIP39_WORDLIST_LENGTH } from './wordlist';

export const CHARSET_UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const CHARSET_LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
export const CHARSET_DIGITS = '0123456789';
export const CHARSET_SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
export const AMBIGUOUS_CHARS = '0O1lI';

export interface PasswordGeneratorOptions {
  length: number;          // 4 to 128 (default: 20)
  includeUppercase: boolean; // default: true
  includeLowercase: boolean; // default: true
  includeDigits: boolean;    // default: true
  includeSymbols: boolean;   // default: true
  avoidAmbiguous: boolean;   // default: false
}

export interface PassphraseGeneratorOptions {
  wordCount: number;         // 3 to 12 (default: 5)
  separator: string;         // '-', '.', '_', ' ' (default: '-')
  capitalize: boolean;       // default: false
}

export type PasswordStrengthScore = 'weak' | 'fair' | 'good' | 'strong' | 'excellent';

export interface PasswordEntropyResult {
  bits: number;
  score: PasswordStrengthScore;
  label: string;
}

/**
 * Filter out ambiguous characters from a charset if requested.
 */
function filterAmbiguous(charset: string, avoid: boolean): string {
  if (!avoid) return charset;
  const ambiguousSet = new Set(AMBIGUOUS_CHARS);
  return Array.from(charset).filter(c => !ambiguousSet.has(c)).join('');
}

/**
 * Generates an unbiased, cryptographically secure password based on selected character sets.
 * Guarantees that at least one character from each enabled charset is present.
 */
export function generatePassword(options: Partial<PasswordGeneratorOptions> = {}): string {
  const length = Math.max(4, Math.min(128, options.length ?? 20));
  const avoidAmbiguous = options.avoidAmbiguous ?? false;

  const upper = filterAmbiguous(CHARSET_UPPERCASE, avoidAmbiguous);
  const lower = filterAmbiguous(CHARSET_LOWERCASE, avoidAmbiguous);
  const digits = filterAmbiguous(CHARSET_DIGITS, avoidAmbiguous);
  const symbols = filterAmbiguous(CHARSET_SYMBOLS, avoidAmbiguous);

  const activePools: string[] = [];

  if (options.includeUppercase ?? true) activePools.push(upper);
  if (options.includeLowercase ?? true) activePools.push(lower);
  if (options.includeDigits ?? true) activePools.push(digits);
  if (options.includeSymbols ?? true) activePools.push(symbols);

  // Fallback if user unchecks all boxes: default to lowercase and digits
  if (activePools.length === 0) {
    activePools.push(lower, digits);
  }

  const chars: string[] = [];

  // Guarantee at least one character from each selected charset
  for (const pool of activePools) {
    if (pool.length > 0) {
      chars.push(getUnbiasedRandomChar(pool));
    }
  }

  // Combined charset for the remaining characters
  const combinedPool = activePools.join('');
  if (combinedPool.length === 0) {
    throw new Error('No character sets available for password generation.');
  }

  // Fill the remaining length with unbiased selections
  while (chars.length < length) {
    chars.push(getUnbiasedRandomChar(combinedPool));
  }

  // Uniformly shuffle the array with CSPRNG Fisher-Yates
  return secureShuffle(chars).join('');
}

/**
 * Generates an unbiased Diceware passphrase using the 2,048 BIP-39 English wordlist.
 * Each word provides exactly 11 bits of entropy (2^11 = 2048).
 */
export function generatePassphrase(options: Partial<PassphraseGeneratorOptions> = {}): string {
  const wordCount = Math.max(3, Math.min(12, options.wordCount ?? 5));
  const separator = options.separator ?? '-';
  const capitalize = options.capitalize ?? false;

  const words: string[] = [];
  const buffer = new Uint16Array(1);

  for (let i = 0; i < wordCount; i++) {
    crypto.getRandomValues(buffer);
    // Since 65536 / 2048 = 32 exactly, 65536 % 2048 === 0.
    // Therefore buffer[0] % 2048 produces perfectly uniform distribution with zero modulo bias!
    const index = buffer[0] % BIP39_WORDLIST_LENGTH;
    let word = BIP39_ENGLISH_WORDLIST[index];

    if (capitalize) {
      word = word.charAt(0).toUpperCase() + word.slice(1);
    }
    words.push(word);
  }

  return words.join(separator);
}

/**
 * Calculates Shannon entropy (bits) and maps to user-friendly strength ratings.
 * E = L * log2(N)
 */
export function calculatePasswordEntropy(password: string): PasswordEntropyResult {
  if (!password || password.length === 0) {
    return { bits: 0, score: 'weak', label: 'Empty' };
  }

  // Check if it is a Diceware passphrase (words from BIP-39 separated by standard delimiters)
  const separators = ['-', '.', '_', ' '];
  for (const sep of separators) {
    if (password.includes(sep)) {
      const parts = password.split(sep);
      if (parts.length >= 3 && parts.every(p => BIP39_ENGLISH_WORDLIST.includes(p.toLowerCase()))) {
        const bits = parts.length * 11;
        return {
          bits,
          score: bits >= 66 ? 'excellent' : bits >= 55 ? 'strong' : bits >= 44 ? 'good' : 'fair',
          label: bits >= 66 ? 'Very Strong' : bits >= 55 ? 'Strong' : bits >= 44 ? 'Good' : 'Fair'
        };
      }
    }
  }

  // General character password entropy
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9\s]/.test(password)) poolSize += 32;
  if (/\s/.test(password)) poolSize += 1;

  if (poolSize === 0) poolSize = 10;

  const bits = Math.round(password.length * Math.log2(poolSize));

  if (bits < 40) {
    return { bits, score: 'weak', label: 'Weak' };
  } else if (bits < 60) {
    return { bits, score: 'fair', label: 'Fair' };
  } else if (bits < 80) {
    return { bits, score: 'good', label: 'Good' };
  } else if (bits < 100) {
    return { bits, score: 'strong', label: 'Strong' };
  } else {
    return { bits, score: 'excellent', label: 'Very Strong' };
  }
}
