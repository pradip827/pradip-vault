import { describe, it, expect } from 'vitest';
import {
  generatePassword,
  generatePassphrase,
  calculatePasswordEntropy,
  CHARSET_UPPERCASE,
  CHARSET_LOWERCASE,
  CHARSET_DIGITS,
  CHARSET_SYMBOLS,
  AMBIGUOUS_CHARS
} from './generator';
import { BIP39_ENGLISH_WORDLIST } from './wordlist';

describe('CSPRNG Unbiased Password & Passphrase Generator', () => {
  describe('generatePassword', () => {
    it('should generate a password of exact requested length', () => {
      expect(generatePassword({ length: 8 }).length).toBe(8);
      expect(generatePassword({ length: 16 }).length).toBe(16);
      expect(generatePassword({ length: 32 }).length).toBe(32);
      expect(generatePassword({ length: 64 }).length).toBe(64);
    });

    it('should clamp lengths to valid boundaries (4 to 128)', () => {
      expect(generatePassword({ length: 1 }).length).toBe(4);
      expect(generatePassword({ length: 200 }).length).toBe(128);
    });

    it('should guarantee at least one character from each active character set', () => {
      // Run multiple times to verify guarantee is consistent
      for (let i = 0; i < 20; i++) {
        const pwd = generatePassword({
          length: 12,
          includeUppercase: true,
          includeLowercase: true,
          includeDigits: true,
          includeSymbols: true
        });

        const hasUpper = Array.from(CHARSET_UPPERCASE).some(c => pwd.includes(c));
        const hasLower = Array.from(CHARSET_LOWERCASE).some(c => pwd.includes(c));
        const hasDigit = Array.from(CHARSET_DIGITS).some(c => pwd.includes(c));
        const hasSymbol = Array.from(CHARSET_SYMBOLS).some(c => pwd.includes(c));

        expect(hasUpper).toBe(true);
        expect(hasLower).toBe(true);
        expect(hasDigit).toBe(true);
        expect(hasSymbol).toBe(true);
      }
    });

    it('should exclude ambiguous characters when avoidAmbiguous is true', () => {
      const ambiguousSet = new Set(AMBIGUOUS_CHARS);

      for (let i = 0; i < 30; i++) {
        const pwd = generatePassword({
          length: 40,
          avoidAmbiguous: true
        });

        for (const char of pwd) {
          expect(ambiguousSet.has(char)).toBe(false);
        }
      }
    });

    it('should support generating digits-only passwords (e.g. PINs)', () => {
      const pin = generatePassword({
        length: 8,
        includeUppercase: false,
        includeLowercase: false,
        includeDigits: true,
        includeSymbols: false
      });

      expect(pin.length).toBe(8);
      expect(/^\d+$/.test(pin)).toBe(true);
    });

    it('should default to lowercase and digits if user disables all character sets', () => {
      const pwd = generatePassword({
        length: 16,
        includeUppercase: false,
        includeLowercase: false,
        includeDigits: false,
        includeSymbols: false
      });

      expect(pwd.length).toBe(16);
      expect(/^[a-z0-9]+$/.test(pwd)).toBe(true);
    });
  });

  describe('generatePassphrase', () => {
    it('should generate the exact requested number of words', () => {
      const p3 = generatePassphrase({ wordCount: 3 });
      expect(p3.split('-').length).toBe(3);

      const p5 = generatePassphrase({ wordCount: 5 });
      expect(p5.split('-').length).toBe(5);

      const p8 = generatePassphrase({ wordCount: 8 });
      expect(p8.split('-').length).toBe(8);
    });

    it('should use the chosen delimiter separator', () => {
      const dot = generatePassphrase({ wordCount: 4, separator: '.' });
      expect(dot.split('.').length).toBe(4);

      const space = generatePassphrase({ wordCount: 4, separator: ' ' });
      expect(space.split(' ').length).toBe(4);

      const underscore = generatePassphrase({ wordCount: 4, separator: '_' });
      expect(underscore.split('_').length).toBe(4);
    });

    it('should select words strictly from the BIP-39 English wordlist', () => {
      const phrase = generatePassphrase({ wordCount: 6, separator: '-' });
      const words = phrase.split('-');

      const wordlistSet = new Set(BIP39_ENGLISH_WORDLIST);
      for (const w of words) {
        expect(wordlistSet.has(w.toLowerCase())).toBe(true);
      }
    });

    it('should capitalize each word when capitalize option is true', () => {
      const phrase = generatePassphrase({ wordCount: 4, capitalize: true, separator: '-' });
      const words = phrase.split('-');

      for (const w of words) {
        expect(w[0]).toBe(w[0].toUpperCase());
        expect(w.slice(1)).toBe(w.slice(1).toLowerCase());
      }
    });
  });

  describe('calculatePasswordEntropy', () => {
    it('should return 0 bits for empty password', () => {
      const res = calculatePasswordEntropy('');
      expect(res.bits).toBe(0);
      expect(res.score).toBe('weak');
    });

    it('should identify weak short passwords', () => {
      const res = calculatePasswordEntropy('password');
      expect(res.bits).toBeLessThan(40);
      expect(res.score).toBe('weak');
    });

    it('should score 16+ character complex passwords as strong or excellent', () => {
      const res = calculatePasswordEntropy('Kx9#mP2$vL5@wQ8!');
      expect(res.bits).toBeGreaterThanOrEqual(80);
      expect(['strong', 'excellent']).toContain(res.score);
    });

    it('should correctly calculate BIP-39 passphrase entropy at 11 bits per word', () => {
      // 5 words * 11 = 55 bits
      const res5 = calculatePasswordEntropy('abandon-ability-able-about-above');
      expect(res5.bits).toBe(55);
      expect(res5.score).toBe('strong');

      // 6 words * 11 = 66 bits
      const res6 = calculatePasswordEntropy('abandon-ability-able-about-above-absent');
      expect(res6.bits).toBe(66);
      expect(res6.score).toBe('excellent');
    });
  });
});
