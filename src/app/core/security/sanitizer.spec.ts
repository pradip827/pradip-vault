import { describe, it, expect } from 'vitest';
import {
  containsDangerousScheme,
  isValidWebUrl,
  sanitizeWebUrl,
  getSafeExternalLinkProps,
  sanitizeDisplayText
} from './sanitizer';

describe('Sanitizer Security Utilities', () => {
  describe('containsDangerousScheme', () => {
    it('should detect standard dangerous schemes', () => {
      expect(containsDangerousScheme('javascript:alert(1)')).toBe(true);
      expect(containsDangerousScheme('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(true);
      expect(containsDangerousScheme('vbscript:MsgBox(1)')).toBe(true);
      expect(containsDangerousScheme('file:///etc/passwd')).toBe(true);
      expect(containsDangerousScheme('blob:https://example.com/uuid')).toBe(true);
    });

    it('should detect mixed case and whitespace evasion attempts', () => {
      expect(containsDangerousScheme('JAVAscript:alert(1)')).toBe(true);
      expect(containsDangerousScheme('  javascript:alert(1)')).toBe(true);
      expect(containsDangerousScheme('java\nscript:alert(1)')).toBe(true);
      expect(containsDangerousScheme('java\tscript:alert(1)')).toBe(true);
      expect(containsDangerousScheme('DATA:text/plain,foo')).toBe(true);
    });

    it('should allow legitimate schemes', () => {
      expect(containsDangerousScheme('https://github.com')).toBe(false);
      expect(containsDangerousScheme('http://localhost:3000')).toBe(false);
      expect(containsDangerousScheme('example.com')).toBe(false);
    });
  });

  describe('isValidWebUrl', () => {
    it('should accept valid https and http URLs', () => {
      expect(isValidWebUrl('https://github.com')).toBe(true);
      expect(isValidWebUrl('https://accounts.google.com/login?service=mail')).toBe(true);
      expect(isValidWebUrl('http://localhost:4200')).toBe(true);
      expect(isValidWebUrl('http://192.168.1.1:8080/admin')).toBe(true);
    });

    it('should accept domain-only entries (auto-prefixed with https://)', () => {
      expect(isValidWebUrl('github.com')).toBe(true);
      expect(isValidWebUrl('sub.domain.co.uk/path')).toBe(true);
    });

    it('should reject dangerous and malicious schemes', () => {
      expect(isValidWebUrl('javascript:alert(document.cookie)')).toBe(false);
      expect(isValidWebUrl('javascript://alert(1)')).toBe(false);
      expect(isValidWebUrl('data:text/html,evil')).toBe(false);
      expect(isValidWebUrl('vbscript:alert(1)')).toBe(false);
      expect(isValidWebUrl('file:///etc/hosts')).toBe(false);
    });

    it('should reject invalid or malformed strings', () => {
      expect(isValidWebUrl('')).toBe(false);
      expect(isValidWebUrl('   ')).toBe(false);
      expect(isValidWebUrl(null as unknown as string)).toBe(false);
      expect(isValidWebUrl('http://')).toBe(false);
    });
  });

  describe('sanitizeWebUrl', () => {
    it('should normalize URLs without protocol to https', () => {
      expect(sanitizeWebUrl('github.com')).toBe('https://github.com/');
      expect(sanitizeWebUrl('example.com/login')).toBe('https://example.com/login');
    });

    it('should preserve valid http and https URLs', () => {
      expect(sanitizeWebUrl('https://vault.example.com')).toBe('https://vault.example.com/');
      expect(sanitizeWebUrl('http://localhost:3000')).toBe('http://localhost:3000/');
    });

    it('should neutralize dangerous schemes by returning empty string', () => {
      expect(sanitizeWebUrl('javascript:alert(1)')).toBe('');
      expect(sanitizeWebUrl('data:text/html,<script>alert(1)</script>')).toBe('');
      expect(sanitizeWebUrl('vbscript:msgbox(1)')).toBe('');
      expect(sanitizeWebUrl('file:///C:/Windows/System32')).toBe('');
    });

    it('should trim surrounding whitespace', () => {
      expect(sanitizeWebUrl('  https://github.com  ')).toBe('https://github.com/');
    });
  });

  describe('getSafeExternalLinkProps', () => {
    it('should return strict security attributes for external links', () => {
      const props = getSafeExternalLinkProps();
      expect(props.rel).toBe('noopener noreferrer');
      expect(props.target).toBe('_blank');
    });
  });

  describe('sanitizeDisplayText', () => {
    it('should strip non-printable ASCII control characters', () => {
      const malicious = 'Secret\x00Title\x07With\x1FControlChars';
      expect(sanitizeDisplayText(malicious)).toBe('SecretTitleWithControlChars');
    });

    it('should preserve newlines, tabs, and unicode characters', () => {
      const input = 'Line 1\nLine 2\tIndented with 🚀 emoji';
      expect(sanitizeDisplayText(input)).toBe('Line 1\nLine 2\tIndented with 🚀 emoji');
    });
  });
});
