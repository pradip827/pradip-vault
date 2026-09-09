/**
 * ZeroVault Extension - Background Service Worker
 * Secure Authenticated Bridge & Least-Privilege Autofill Dispatcher
 *
 * Security Invariants:
 * 1. ZERO decrypted vault storage (never persisted in chrome.storage or IndexedDB).
 * 2. ZERO plaintext master password retention (no activeMasterPassword variable).
 * 3. Ephemeral in-memory session: restarted MV3 service worker is locked by default.
 * 4. Least Privilege: content scripts only receive metadata ({ id, title, username })
 *    until explicit user interaction requests a single credential.
 * 5. Strict Origin Verification: enforces exact origin matching to block cousin/spoof domains.
 */

const AUTHORIZED_WEB_VAULT_ORIGIN = 'https://pradip-vault.pages.dev';

// In-memory ephemeral session state (NEVER persisted to disk)
let activeSession = null;

let nextRequestId = 1;
const pendingRequests = new Map();

/**
 * Normalizes an arbitrary URL to its origin (protocol + host + effective port).
 */
export function normalizeOrigin(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  // Strictly require explicit absolute http:// or https:// schemes (no silent scheme inference)
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return '';
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return '';
    }
    if (!u.hostname || u.hostname.startsWith('.') || u.hostname.endsWith('.') || (!u.hostname.includes('.') && u.hostname !== 'localhost')) {
      return '';
    }
    return u.origin.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Validates whether credentialUrl and targetUrl belong to the exact same normalized origin.
 * Strict same-origin enforcement: protocol, hostname, and effective port must match.
 * Disallows subdomain matching by default (e.g. gist.github.com != github.com),
 * cousin-domain attacks, and protocol downgrades.
 */
export function isOriginMatch(credentialUrl, targetUrl) {
  if (!credentialUrl || !targetUrl) return false;
  const credOrigin = normalizeOrigin(credentialUrl);
  const targetOrigin = normalizeOrigin(targetUrl);
  if (!credOrigin || !targetOrigin) return false;
  return credOrigin === targetOrigin;
}

/**
 * Checks if the current session is active, valid, and connected.
 */
export function isSessionValid() {
  if (!activeSession) return false;
  if (Date.now() > activeSession.expiresAt) {
    lockSession();
    return false;
  }
  if (!activeSession.port) return false;
  return true;
}

export function lockSession() {
  if (activeSession?.port) {
    try {
      activeSession.port.disconnect();
    } catch {}
  }
  activeSession = null;
  pendingRequests.forEach(({ timer, reject }) => {
    clearTimeout(timer);
    reject(new Error('Vault locked'));
  });
  pendingRequests.clear();

  chrome.action?.setBadgeText({ text: '' });
  notifyTabsOfVaultChange();
}

/**
 * Notifies all active HTTP/HTTPS tabs of vault state changes to update in-page badges.
 */
function notifyTabsOfVaultChange() {
  chrome.tabs?.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        chrome.tabs.sendMessage(tab.id, { type: 'ZEROVAULT_STATE_CHANGED' }, () => {
          if (chrome.runtime.lastError) {
            // Ignore closed/unready content scripts
          }
        });
      }
    });
  });
}

/**
 * Sends a least-privilege request over the authenticated Web Vault Port.
 */
function sendPortRequest(type, payload = {}, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    if (!isSessionValid()) {
      return reject(new Error('Extension is locked. Unlock Pradip Vault Web App.'));
    }

    const requestId = 'req_' + (nextRequestId++) + '_' + self.crypto.randomUUID().replace(/-/g, '').substring(0, 8);
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Request to Web Vault timed out.'));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timer });

    try {
      activeSession.port.postMessage({
        requestId,
        type,
        sessionToken: activeSession.token,
        ...payload
      });
    } catch (e) {
      clearTimeout(timer);
      pendingRequests.delete(requestId);
      lockSession();
      reject(new Error('Connection to Web Vault closed.'));
    }
  });
}

// --------------------------------------------------------------------------
// 1. Authenticated External Channel (Web Vault -> Extension Service Worker)
// --------------------------------------------------------------------------

chrome.runtime?.onConnectExternal?.addListener((port) => {
  const senderOrigin = port.sender?.origin || '';
  if (senderOrigin !== AUTHORIZED_WEB_VAULT_ORIGIN || port.name !== 'zerovault-authenticated-bridge') {
    console.warn('[ZeroVault Security] Rejected external connection from unauthorized origin or invalid port name:', senderOrigin, port.name);
    port.disconnect();
    return;
  }

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'ESTABLISH_AUTH_SESSION') {
      if (
        !msg.sessionToken ||
        typeof msg.sessionToken !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(msg.sessionToken) ||
        typeof msg.expiresAt !== 'number' ||
        msg.expiresAt <= Date.now()
      ) {
        console.warn('[ZeroVault Security] Rejected invalid ESTABLISH_AUTH_SESSION payload');
        port.disconnect();
        return;
      }
      activeSession = {
        token: msg.sessionToken,
        expiresAt: msg.expiresAt,
        vaultName: typeof msg.vaultName === 'string' ? msg.vaultName : 'ZeroVault',
        port
      };
      chrome.action?.setBadgeText({ text: '✓' });
      chrome.action?.setBadgeBackgroundColor({ color: '#10b981' });
      notifyTabsOfVaultChange();
    } else if (msg.type === 'REVOKE_AUTH_SESSION') {
      if (activeSession && activeSession.token === msg.sessionToken) {
        lockSession();
      }
    } else if (msg.requestId && pendingRequests.has(msg.requestId)) {
      const { resolve, reject, timer } = pendingRequests.get(msg.requestId);
      clearTimeout(timer);
      pendingRequests.delete(msg.requestId);
      if (msg.success === false) {
        reject(new Error(msg.error || 'Request failed'));
      } else {
        resolve(msg);
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (activeSession && activeSession.port === port) {
      lockSession();
    }
  });
});

chrome.runtime?.onMessageExternal?.addListener((msg, sender, sendResponse) => {
  const origin = sender.origin || '';
  if (origin !== AUTHORIZED_WEB_VAULT_ORIGIN) {
    sendResponse({ success: false, error: 'Unauthorized origin' });
    return;
  }

  if (msg.type === 'PING') {
    sendResponse({ success: true, isConnected: isSessionValid() });
  } else {
    sendResponse({ success: false, error: 'Unsupported message' });
  }
});

// --------------------------------------------------------------------------
// 2. Internal Messaging Channel (Content Script / Popup -> Service Worker)
// --------------------------------------------------------------------------

chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    switch (message.type) {
      case 'GET_STATUS': {
        return {
          isUnlocked: isSessionValid(),
          vaultName: activeSession?.vaultName || 'ZeroVault'
        };
      }

      case 'GET_MATCHING_LOGINS': {
        return {
          success: false,
          error: 'Legacy GET_MATCHING_LOGINS is disabled. Use GET_MATCHING_METADATA for least-privilege scanning.'
        };
      }

      case 'GET_MATCHING_METADATA': {
        if (!isSessionValid()) {
          return { isUnlocked: false, matches: [] };
        }

        // Determine target origin from sender tab URL (browser-verified) or popup message URL
        const targetUrl = sender.tab ? sender.tab.url : message.url;
        const origin = normalizeOrigin(targetUrl);
        if (!origin) {
          return { isUnlocked: true, matches: [] };
        }

        try {
          const res = await sendPortRequest('QUERY_ORIGIN_METADATA', { origin });
          return {
            isUnlocked: true,
            matches: res.matches || [] // Strictly metadata only: { id, title, username, website }
          };
        } catch (err) {
          return { isUnlocked: false, matches: [], error: err.message };
        }
      }

      case 'REQUEST_CREDENTIAL_AUTOFILL': {
        if (!isSessionValid()) {
          return { success: false, error: 'Vault is locked' };
        }

        // Verify sender tab context (either directly from content script or from trusted popup querying active tab)
        let tabUrl = sender.tab?.url;
        const isFromPopup = !sender.tab && (sender.id === chrome.runtime?.id || sender.url?.includes('/popup/'));
        if (isFromPopup && message.tabUrl) {
          tabUrl = message.tabUrl;
        }

        if (!tabUrl) {
          return { success: false, error: 'Unauthorized tab context' };
        }

        const tabOrigin = normalizeOrigin(tabUrl);
        if (!tabOrigin) {
          return { success: false, error: 'Invalid or unsupported tab origin' };
        }

        const { credentialId } = message;
        if (!credentialId) {
          return { success: false, error: 'Missing credentialId' };
        }

        try {
          const res = await sendPortRequest('RETRIEVE_CREDENTIAL_FOR_FILL', {
            credentialId,
            tabOrigin
          });

          // Single credential returned for immediate DOM injection
          return {
            success: true,
            credential: res.credential
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case 'REQUEST_SAVE_CREDENTIAL': {
        if (!isSessionValid()) {
          return { success: false, error: 'Vault is locked' };
        }

        if (!sender.tab || !sender.tab.url) {
          return { success: false, error: 'Unauthorized tab context' };
        }

        const tabOrigin = normalizeOrigin(sender.tab.url);
        const { credential } = message;

        try {
          const res = await sendPortRequest('SAVE_CREDENTIAL_FROM_EXTENSION', {
            credential,
            tabOrigin
          });
          return { success: true, isNew: res.isNew };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case 'LOCK_SESSION': {
        lockSession();
        return { success: true };
      }

      default:
        throw new Error('Unknown message type');
    }
  };

  handle()
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ success: false, error: err.message || String(err) }));

  return true; // Keep asynchronous message response open
});
