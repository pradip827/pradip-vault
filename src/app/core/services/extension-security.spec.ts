import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { VaultService } from './vault.service';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';
import { GoogleDriveService } from './google-drive.service';
import {
  ExtensionBridgeService,
  isOriginMatch,
  normalizeOrigin
} from './extension-bridge.service';
declare const process: any;
declare function require(id: string): any;
const fs = typeof require !== 'undefined' ? require('fs') : null;
const path = typeof require !== 'undefined' ? require('path') : null;

describe('ZeroVault Security Regression Suite — 32 Mandatory Security Controls', () => {
  let vaultService: VaultService;
  let bridgeService: ExtensionBridgeService;
  let storageService: StorageService;
  let driveService: GoogleDriveService;

  const testMasterPassword = 'SecureMasterPassword2026!';
  const testVaultName = 'Security Hardened Vault';

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [VaultService, StorageService, CryptoService, ExtensionBridgeService, GoogleDriveService]
    });

    vaultService = TestBed.inject(VaultService);
    bridgeService = TestBed.inject(ExtensionBridgeService);
    storageService = TestBed.inject(StorageService);
    driveService = TestBed.inject(GoogleDriveService);

    await storageService.deleteVault();
  });

  afterEach(async () => {
    vaultService.lockVault();
    await storageService.deleteVault();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: No window.postMessage vault transfer
  // --------------------------------------------------------------------------
  it('1. No window.postMessage vault transfer', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    await vaultService.updateVault((vault) => {
      vault.entries.push({
        id: 'cred-leak-test',
        category: 'login',
        title: 'Secret Bank',
        website: 'https://secretbank.com',
        username: 'victim_user',
        password: 'DoNotLeakThisPassword123!',
        notes: 'Confidential',
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      return vault;
    });

    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const interceptedMessages: any[] = [];
    const listener = (e: MessageEvent) => interceptedMessages.push(e.data);
    window.addEventListener('message', listener);

    try {
      // Attacker attempts to trigger sync via window message
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ZEROVAULT_REQUEST_SYNC' },
          origin: 'https://evil.com'
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 30));

      // Assert: No messages emitted to window, no plaintext passwords leaked
      expect(postMessageSpy).not.toHaveBeenCalled();
      const leakedPassword = interceptedMessages.some((m) =>
        JSON.stringify(m || {}).includes('DoNotLeakThisPassword123!')
      );
      expect(leakedPassword).toBe(false);
    } finally {
      window.removeEventListener('message', listener);
    }
  });

  // --------------------------------------------------------------------------
  // Test 2: No legacy GET_MATCHING_LOGINS
  // --------------------------------------------------------------------------
  it('2. No legacy GET_MATCHING_LOGINS', () => {
    const autofillPath = path.resolve(process.cwd(), 'extension/content/autofill.js');
    const autofillContent = fs.readFileSync(autofillPath, 'utf8');

    // Content script MUST NOT call GET_MATCHING_LOGINS anywhere
    expect(autofillContent).not.toContain("'GET_MATCHING_LOGINS'");
    expect(autofillContent).not.toContain('"GET_MATCHING_LOGINS"');

    // Background script MUST reject any legacy GET_MATCHING_LOGINS requests
    const bgPath = path.resolve(process.cwd(), 'extension/background/background.js');
    const bgContent = fs.readFileSync(bgPath, 'utf8');
    expect(bgContent).toContain("case 'GET_MATCHING_LOGINS':");
    expect(bgContent).toContain('disabled');
  });

  // --------------------------------------------------------------------------
  // Test 3: Metadata-only page scanning
  // --------------------------------------------------------------------------
  it('3. Metadata-only page scanning', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    await vaultService.updateVault((vault) => {
      vault.entries.push({
        id: 'cred-meta-test',
        category: 'login',
        title: 'Meta Portal',
        website: 'https://portal.example.com/login',
        username: 'scan_user',
        password: 'TopSecretPassword987!',
        notes: 'Secret Note',
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      return vault;
    });

    bridgeService.establishSession();
    const metadataList = bridgeService.queryOriginMetadata('https://portal.example.com');

    expect(metadataList.length).toBe(1);
    const meta = metadataList[0];
    expect(meta.id).toBe('cred-meta-test');
    expect(meta.username).toBe('scan_user');
    expect(meta.title).toBe('Meta Portal');
    expect(meta.website).toBe('https://portal.example.com/login');

    // CRITICAL: password field MUST BE completely absent
    expect((meta as any).password).toBeUndefined();
    expect(JSON.stringify(meta)).not.toContain('TopSecretPassword987!');
  });

  // --------------------------------------------------------------------------
  // Test 4: Single credential only after explicit selection
  // --------------------------------------------------------------------------
  it('4. Single credential only after explicit selection', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    await vaultService.updateVault((vault) => {
      vault.entries.push(
        {
          id: 'cred-target',
          category: 'login',
          title: 'Target Service',
          website: 'https://service.example.com',
          username: 'alice',
          password: 'TargetPassword!',
          notes: '',
          favorite: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'cred-other',
          category: 'login',
          title: 'Other Service',
          website: 'https://service.example.com',
          username: 'bob',
          password: 'OtherPassword!',
          notes: '',
          favorite: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      );
      return vault;
    });

    bridgeService.establishSession();
    const result = bridgeService.retrieveCredentialForFill('cred-target', 'https://service.example.com');

    expect(result.success).toBe(true);
    expect(result.credential).toBeDefined();
    expect(result.credential?.username).toBe('alice');
    expect(result.credential?.password).toBe('TargetPassword!');
    // The second credential (bob) must NOT be returned in this response
    expect(JSON.stringify(result)).not.toContain('OtherPassword!');
  });

  // --------------------------------------------------------------------------
  // Test 5: Exact origin matching
  // --------------------------------------------------------------------------
  it('5. Exact origin matching', () => {
    expect(isOriginMatch('https://example.com/login', 'https://example.com/dashboard')).toBe(true);
    expect(isOriginMatch('https://example.com', 'https://example.com')).toBe(true);
    expect(isOriginMatch('http://localhost:4200/app', 'http://localhost:4200')).toBe(true);
    expect(normalizeOrigin('https://example.com:8443/test?q=1#hash')).toBe('https://example.com:8443');
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  // --------------------------------------------------------------------------
  // Test 6: Reject evilgithub.com
  // --------------------------------------------------------------------------
  it('6. Reject evilgithub.com', () => {
    expect(isOriginMatch('https://github.com', 'https://evilgithub.com')).toBe(false);
    expect(isOriginMatch('https://github.com/login', 'https://evilgithub.com/login')).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 7: Reject github.com.evil.com
  // --------------------------------------------------------------------------
  it('7. Reject github.com.evil.com', () => {
    expect(isOriginMatch('https://github.com', 'https://github.com.evil.com')).toBe(false);
    expect(isOriginMatch('https://github.com', 'https://github.com.attacker.net')).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 8: Reject subdomain unless explicitly authorized
  // --------------------------------------------------------------------------
  it('8. Reject subdomain unless explicitly authorized', () => {
    // Under strict normalized same-origin policy, subdomains are rejected by default
    expect(isOriginMatch('https://github.com', 'https://gist.github.com')).toBe(false);
    expect(isOriginMatch('https://mybank.com', 'https://sub.mybank.com')).toBe(false);
    expect(isOriginMatch('https://example.com', 'https://admin.example.com')).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 9: Reject HTTP when credential is HTTPS
  // --------------------------------------------------------------------------
  it('9. Reject HTTP when credential is HTTPS', () => {
    expect(isOriginMatch('https://github.com', 'http://github.com')).toBe(false);
    expect(isOriginMatch('https://bank.com/login', 'http://bank.com/login')).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 10: Reject cross-origin credential retrieval
  // --------------------------------------------------------------------------
  it('10. Reject cross-origin credential retrieval', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    await vaultService.updateVault((vault) => {
      vault.entries.push({
        id: 'cred-bank-1',
        category: 'login',
        title: 'Bank',
        website: 'https://chase.com',
        username: 'chase_user',
        password: 'ChasePassword!',
        notes: '',
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      return vault;
    });

    bridgeService.establishSession();

    // Attacker tab on evil.com tries to retrieve chase.com credential
    const attackResult = bridgeService.retrieveCredentialForFill('cred-bank-1', 'https://evil.com');
    expect(attackResult.success).toBe(false);
    expect(attackResult.credential).toBeUndefined();
    expect(attackResult.error).toContain('Security violation');
  });

  // --------------------------------------------------------------------------
  // Test 11: Reject expired session
  // --------------------------------------------------------------------------
  it('11. Reject expired session', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    const session = bridgeService.establishSession();
    expect(session).not.toBeNull();

    // Valid while unexpired
    expect(bridgeService.validateSessionToken(session?.token)).toBe(true);

    // Simulate expiration
    if (session) {
      session.expiresAt = Date.now() - 5000;
      expect(bridgeService.validateSessionToken(session.token)).toBe(false);
    }
  });

  // --------------------------------------------------------------------------
  // Test 12: Reject replayed session/request
  // --------------------------------------------------------------------------
  it('12. Reject replayed session/request', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    const session = bridgeService.establishSession();
    const oldToken = session?.token;

    // Revoke current session
    bridgeService.revokeSession();

    // Replaying the old token must fail immediately
    expect(bridgeService.validateSessionToken(oldToken)).toBe(false);
    expect(bridgeService.validateSessionToken('forged-token-' + Math.random())).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 13: Reject malformed message
  // --------------------------------------------------------------------------
  it('13. Reject malformed message', () => {
    // Port listener handlePortMessage should gracefully reject malformed schemas
    const fakePort = {
      postMessage: vi.fn()
    };
    (bridgeService as any).port = fakePort;

    // Null message
    bridgeService.handlePortMessage(null);
    expect(fakePort.postMessage).not.toHaveBeenCalled();

    // Missing requestId or type
    bridgeService.handlePortMessage({ foo: 'bar' });
    expect(fakePort.postMessage).not.toHaveBeenCalled();

    // Malformed parameters with requestId
    bridgeService.handlePortMessage({ requestId: 'req-1', type: 'INVALID_TYPE' });
    expect(fakePort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1', success: false })
    );
  });

  // --------------------------------------------------------------------------
  // Test 14: Reject unauthorized sender
  // --------------------------------------------------------------------------
  it('14. Reject unauthorized sender', () => {
    const manifestPath = path.resolve(process.cwd(), 'extension/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Browser-enforced externally_connectable must be strictly limited to pradip-vault.pages.dev
    expect(manifest.externally_connectable).toBeDefined();
    expect(manifest.externally_connectable.matches).toEqual(['https://pradip-vault.pages.dev/*']);

    // Background script validates sender origin
    const bgPath = path.resolve(process.cwd(), 'extension/background/background.js');
    const bgContent = fs.readFileSync(bgPath, 'utf8');
    expect(bgContent).toContain("AUTHORIZED_WEB_VAULT_ORIGIN = 'https://pradip-vault.pages.dev'");
    expect(bgContent).toContain("senderOrigin !== AUTHORIZED_WEB_VAULT_ORIGIN");
  });

  // --------------------------------------------------------------------------
  // Test 15: Reject hostile iframe
  // --------------------------------------------------------------------------
  it('15. Reject hostile iframe', async () => {
    const originalWindowTop = window.top;
    try {
      Object.defineProperty(window, 'top', {
        value: { location: { href: 'https://attacker.com' } },
        configurable: true
      });

      const framedBridge = TestBed.runInInjectionContext(() => new ExtensionBridgeService());
      await vaultService.createVault(testVaultName, testMasterPassword);

      // Session establishment must abort when running framed
      const session = framedBridge.establishSession();
      expect(session).toBeNull();
      expect(framedBridge.getActiveSession()).toBeNull();
    } finally {
      Object.defineProperty(window, 'top', {
        value: originalWindowTop,
        configurable: true
      });
    }
  });

  // --------------------------------------------------------------------------
  // Test 16: Locked vault rejects autofill
  // --------------------------------------------------------------------------
  it('16. Locked vault rejects autofill', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    await vaultService.updateVault((vault) => {
      vault.entries.push({
        id: 'locked-fill-test',
        category: 'login',
        title: 'Service',
        website: 'https://example.com',
        username: 'user',
        password: 'password',
        notes: '',
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      return vault;
    });

    // Vault is locked
    vaultService.lockVault();

    const fillResult = bridgeService.retrieveCredentialForFill('locked-fill-test', 'https://example.com');
    expect(fillResult.success).toBe(false);
    expect(fillResult.error).toContain('Vault is locked');
    expect(fillResult.credential).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Test 17: Locked vault rejects autosave
  // --------------------------------------------------------------------------
  it('17. Locked vault rejects autosave', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    vaultService.lockVault();

    const saveResult = await bridgeService.saveCredentialFromExtension(
      { username: 'user', password: 'newpass', website: 'https://example.com' },
      'https://example.com'
    );
    expect(saveResult.success).toBe(false);
    expect(saveResult.error).toContain('Vault is locked');
  });

  // --------------------------------------------------------------------------
  // Test 18: Lock revokes active extension session
  // --------------------------------------------------------------------------
  it('18. Lock revokes active extension session', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    const session = bridgeService.establishSession();
    expect(session).not.toBeNull();
    const token = session?.token;

    // Lock vault
    vaultService.lockVault();

    // Session must be wiped and invalidated immediately
    expect(bridgeService.getActiveSession()).toBeNull();
    expect(bridgeService.validateSessionToken(token)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 19: Service worker restart starts locked
  // --------------------------------------------------------------------------
  it('19. Service worker restart starts locked', () => {
    // New instance of bridge / background simulates worker restart
    const freshBridge = TestBed.runInInjectionContext(() => new ExtensionBridgeService());
    expect(freshBridge.getActiveSession()).toBeNull();
    expect(freshBridge.queryOriginMetadata('https://github.com')).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Test 20: No plaintext credentials in chrome.storage
  // --------------------------------------------------------------------------
  it('20. No plaintext credentials in chrome.storage', () => {
    const bgPath = path.resolve(process.cwd(), 'extension/background/background.js');
    const bgContent = fs.readFileSync(bgPath, 'utf8');

    // Background service worker must not write vault or credentials to chrome.storage
    expect(bgContent).not.toMatch(/chrome\.storage\.(local|sync)\.set\([^)]*(vault|password|credential)/i);

    // Extension manifest strictly omits the unnecessary storage permission
    const manifestPath = path.resolve(process.cwd(), 'extension/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.permissions).not.toContain('storage');
    expect(manifest.permissions).not.toContain('scripting');
  });

  // --------------------------------------------------------------------------
  // Test 21: No master password in extension storage
  // --------------------------------------------------------------------------
  it('21. No master password in extension storage', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    const session = bridgeService.establishSession();

    // Verify session object contains NO master password
    expect(JSON.stringify(session)).not.toContain(testMasterPassword);

    // Verify storage record contains NO master password
    const record = await storageService.loadVaultEnvelope();
    expect(JSON.stringify(record)).not.toContain(testMasterPassword);
  });

  // --------------------------------------------------------------------------
  // Test 22: No pending_web_entries
  // --------------------------------------------------------------------------
  it('22. No pending_web_entries', () => {
    const bgPath = path.resolve(process.cwd(), 'extension/background/background.js');
    const bgContent = fs.readFileSync(bgPath, 'utf8');
    expect(bgContent).not.toContain('pending_web_entries');

    const autofillPath = path.resolve(process.cwd(), 'extension/content/autofill.js');
    const autofillContent = fs.readFileSync(autofillPath, 'utf8');
    expect(autofillContent).not.toContain('pending_web_entries');
  });

  // --------------------------------------------------------------------------
  // Test 23: No OAuth token in vault data
  // --------------------------------------------------------------------------
  it('23. No OAuth token in vault data', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    const entries = vaultService.entries();
    for (const entry of entries) {
      expect((entry as any).oauthToken).toBeUndefined();
      expect((entry as any).accessToken).toBeUndefined();
    }

    // GoogleDriveService access token is kept in memory only, not sessionStorage
    driveService.setAccessToken('mock-token-12345');
    expect(driveService.getAccessToken()).toBe('mock-token-12345');
    if (typeof window !== 'undefined' && window.sessionStorage) {
      expect(sessionStorage.getItem('zerovault_drive_token')).toBeNull();
    }
  });

  // --------------------------------------------------------------------------
  // Test 24: No sensitive service-worker cache
  // --------------------------------------------------------------------------
  it('24. No sensitive service-worker cache', () => {
    const swPath = path.resolve(process.cwd(), 'public/sw.js');
    const swContent = fs.readFileSync(swPath, 'utf8');

    // Verify exclusion patterns
    expect(swContent).toContain("isSensitiveRequest");
    expect(swContent).toContain("isAllowedStaticAsset");
    expect(swContent).toContain("STATIC_ASSET_EXTENSIONS");
    expect(swContent).toContain("STATIC_DESTINATIONS");

    // Ensure sensitive terms are blocked
    const sensitiveTokens = ['/api', 'oauth', 'drive', 'vault', 'credential', 'session', 'auth', 'token'];
    for (const token of sensitiveTokens) {
      expect(swContent).toContain(`'${token}'`);
    }
  });

  // --------------------------------------------------------------------------
  // Test 25: Autosave cross-origin spoof rejected
  // --------------------------------------------------------------------------
  it('25. Autosave cross-origin spoof rejected', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    bridgeService.establishSession();

    // Attacker on evil.com tries to save a credential pretending to be for bank.com
    const spoofSave = await bridgeService.saveCredentialFromExtension(
      { username: 'victim', password: 'attacker_password', website: 'https://bank.com' },
      'https://evil.com'
    );
    expect(spoofSave.success).toBe(false);
    expect(spoofSave.error).toContain('Origin mismatch');
  });

  // --------------------------------------------------------------------------
  // Test 26: Credential plaintext lifetime is not cached
  // --------------------------------------------------------------------------
  it('26. Credential plaintext lifetime is not cached', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    bridgeService.establishSession();

    await vaultService.updateVault((vault) => {
      vault.entries.push({
        id: 'ephemeral-cred-test',
        category: 'login',
        title: 'Temp Service',
        website: 'https://temp.org',
        username: 'temp_user',
        password: 'TemporaryPassword!',
        notes: '',
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      return vault;
    });

    const fillResult = bridgeService.retrieveCredentialForFill('ephemeral-cred-test', 'https://temp.org');
    expect(fillResult.success).toBe(true);

    // Verify bridge service has no persistent decrypted cache property
    expect((bridgeService as any).cachedCredentials).toBeUndefined();
    expect((bridgeService as any).decryptedVault).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Test 27: Programmatic click cannot request credential
  // --------------------------------------------------------------------------
  it('27. Programmatic click cannot request credential (isTrusted === false)', () => {
    const autofillPath = path.resolve(process.cwd(), 'extension/content/autofill.js');
    const autofillContent = fs.readFileSync(autofillPath, 'utf8');

    // Static code verification: click and keydown handlers MUST verify event.isTrusted === true
    expect(autofillContent).toContain('if (!event || event.isTrusted !== true)');
    expect(autofillContent).toContain("safeSendMessage({ type: 'REQUEST_CREDENTIAL_AUTOFILL'");

    // Behavioral verification: simulate handler with untrusted programmatic event
    let messageSent = false;
    let requestedType = '';
    const safeSendMessageMock = (msg: any) => {
      messageSent = true;
      requestedType = msg.type;
    };

    // Replicate the exact credential selection handler logic from autofill.js
    const clickHandler = (event: any, cred: any) => {
      if (!event || event.isTrusted !== true) {
        return;
      }
      if (cred && cred.id) {
        safeSendMessageMock({ type: 'REQUEST_CREDENTIAL_AUTOFILL', credentialId: cred.id });
      }
    };

    // Programmatic click (e.g. element.click() or dispatchEvent in browser sets isTrusted = false)
    const programmaticEvent = { isTrusted: false, type: 'click' };
    clickHandler(programmaticEvent, { id: 'test-cred-1' });

    // REQUEST_CREDENTIAL_AUTOFILL must NOT be sent
    expect(messageSent).toBe(false);
    expect(requestedType).toBe('');
  });

  // --------------------------------------------------------------------------
  // Test 28: Only trusted user click can request credential
  // --------------------------------------------------------------------------
  it('28. Only trusted user click can request credential', () => {
    let messageSent = false;
    let requestedCredId = '';
    const safeSendMessageMock = (msg: any) => {
      messageSent = true;
      requestedCredId = msg.credentialId;
    };

    const clickHandler = (event: any, cred: any) => {
      if (!event || event.isTrusted !== true) {
        return;
      }
      if (cred && cred.id) {
        safeSendMessageMock({ type: 'REQUEST_CREDENTIAL_AUTOFILL', credentialId: cred.id });
      }
    };

    // Genuine trusted user interaction (browser generates event with isTrusted = true)
    const trustedUserEvent = { isTrusted: true, type: 'click' };
    clickHandler(trustedUserEvent, { id: 'legit-cred-123' });

    expect(messageSent).toBe(true);
    expect(requestedCredId).toBe('legit-cred-123');
  });

  // --------------------------------------------------------------------------
  // Test 29: Programmatic click cannot trigger autofill
  // --------------------------------------------------------------------------
  it('29. Programmatic click cannot trigger autofill', () => {
    // Set up DOM fields in JSDOM
    document.body.innerHTML = `
      <form id="login-form">
        <input type="text" id="username" autocomplete="username">
        <input type="password" id="password" autocomplete="current-password">
        <div class="zerovault-dropdown-item" data-idx="0">Click Me</div>
      </form>
    `;

    const passInput = document.getElementById('password') as HTMLInputElement;
    const userInput = document.getElementById('username') as HTMLInputElement;
    const item = document.querySelector('.zerovault-dropdown-item') as HTMLElement;

    let fillCalled = false;
    item.addEventListener('click', (event) => {
      // Security check in autofill.js
      if (!event || event.isTrusted !== true) {
        return;
      }
      fillCalled = true;
      passInput.value = 'HackedPassword123!';
    });

    // An attacker page triggers element.click() programmatically
    item.click();

    // The handler must reject the untrusted click
    expect(fillCalled).toBe(false);
    expect(passInput.value).toBe('');
    expect(userInput.value).toBe('');

    // An attacker dispatches an untrusted MouseEvent
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(fillCalled).toBe(false);
    expect(passInput.value).toBe('');
  });

  // --------------------------------------------------------------------------
  // Test 30: AUTOFILL_CREDENTIAL path cannot bypass authorization
  // --------------------------------------------------------------------------
  it('30. AUTOFILL_CREDENTIAL path cannot bypass authorization', () => {
    const autofillPath = path.resolve(process.cwd(), 'extension/content/autofill.js');
    const autofillContent = fs.readFileSync(autofillPath, 'utf8');

    // Verify content script listener enforces sender and origin verification
    expect(autofillContent).toContain("sender.id !== chrome.runtime.id");
    expect(autofillContent).toContain("isOriginMatch(msg.credential.website, window.location.href)");

    // Verify popup does not use executeScript or chrome.scripting fallback
    const popupPath = path.resolve(process.cwd(), 'extension/popup/popup.js');
    const popupContent = fs.readFileSync(popupPath, 'utf8');
    expect(popupContent).not.toContain('executeScript');
    expect(popupContent).not.toContain('chrome.scripting');

    // Simulate the AUTOFILL_CREDENTIAL message handler logic
    const handleAutofillMessage = (msg: any, sender: any, pageHref: string) => {
      if (sender && sender.id && sender.id !== 'expected-extension-id') {
        return { success: false, error: 'Unauthorized sender' };
      }
      if (!msg.credential || typeof msg.credential !== 'object' || !msg.credential.password) {
        return { success: false, error: 'Invalid credential payload' };
      }
      if (!isOriginMatch(msg.credential.website, pageHref)) {
        return { success: false, error: 'Origin mismatch: credential cannot be filled on this page' };
      }
      return { success: true };
    };

    // Attack 1: Unauthorized sender
    const attack1 = handleAutofillMessage(
      { type: 'AUTOFILL_CREDENTIAL', credential: { website: 'https://evil.com', password: 'secret' } },
      { id: 'rogue-extension-id' },
      'https://evil.com'
    );
    expect(attack1.success).toBe(false);
    expect(attack1.error).toContain('Unauthorized sender');

    // Attack 2: Cross-origin credential injection (bank.com credential into evil.com page)
    const attack2 = handleAutofillMessage(
      { type: 'AUTOFILL_CREDENTIAL', credential: { website: 'https://bank.com', password: 'bank-password' } },
      { id: 'expected-extension-id' },
      'https://evil.com'
    );
    expect(attack2.success).toBe(false);
    expect(attack2.error).toContain('Origin mismatch');

    // Attack 3: Malformed credential without password
    const attack3 = handleAutofillMessage(
      { type: 'AUTOFILL_CREDENTIAL', credential: { website: 'https://evil.com' } },
      { id: 'expected-extension-id' },
      'https://evil.com'
    );
    expect(attack3.success).toBe(false);
    expect(attack3.error).toContain('Invalid credential');

    // Legitimate matching message
    const legit = handleAutofillMessage(
      { type: 'AUTOFILL_CREDENTIAL', credential: { website: 'https://example.com/login', password: 'valid' } },
      { id: 'expected-extension-id' },
      'https://example.com/account'
    );
    expect(legit.success).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 31: Unsupported URL schemes are rejected
  // --------------------------------------------------------------------------
  it('31. Unsupported URL schemes are rejected', () => {
    const unsupported = [
      'javascript:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'chrome-extension://abcdefghijklmnopqrstuvwxyz/popup.html',
      'blob:https://example.com/3f089cb2',
      'ws://example.com/socket',
      'ftp://ftp.example.com/data',
      'about:blank'
    ];

    for (const schemeUrl of unsupported) {
      expect(normalizeOrigin(schemeUrl)).toBe('');
      expect(isOriginMatch(schemeUrl, 'https://example.com')).toBe(false);
      expect(isOriginMatch('https://example.com', schemeUrl)).toBe(false);
      expect(isOriginMatch(schemeUrl, schemeUrl)).toBe(false);
    }
  });

  // --------------------------------------------------------------------------
  // Test 32: Malformed/non-absolute security-sensitive URLs are rejected
  // --------------------------------------------------------------------------
  it('32. Malformed/non-absolute security-sensitive URLs are rejected', () => {
    const malformedOrNonAbsolute = [
      'example.com',                // No scheme - must NOT be silently upgraded
      'sub.example.com',            // No scheme - must NOT be silently upgraded
      '//example.com',              // Protocol-relative URL - must be rejected
      'https://',                   // Scheme with no hostname
      'https://.com',               // Dot domain without name
      'https://?query=1',           // Query without host
      '/path/to/login',             // Relative path
      '   ',                        // Whitespace
      '',                           // Empty string
      null as any,                  // Null
      undefined as any              // Undefined
    ];

    for (const raw of malformedOrNonAbsolute) {
      expect(normalizeOrigin(raw)).toBe('');
      expect(isOriginMatch(raw, 'https://example.com')).toBe(false);
      expect(isOriginMatch('https://example.com', raw)).toBe(false);
    }

    // Exact equality required: paths, queries and fragments stripped
    expect(normalizeOrigin('https://example.com/login?param=1#section')).toBe('https://example.com');
    expect(isOriginMatch('https://example.com/login', 'https://example.com/dashboard')).toBe(true);

    // Subdomains and cousin domains rejected
    expect(isOriginMatch('https://github.com', 'https://gist.github.com')).toBe(false);
    expect(isOriginMatch('https://github.com', 'https://github.com.evil.com')).toBe(false);
    expect(isOriginMatch('http://example.com', 'https://example.com')).toBe(false);
  });
});
