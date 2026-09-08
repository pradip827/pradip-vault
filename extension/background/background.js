/**
 * ZeroVault Extension - Background Service Worker
 * Coordinates Vault State, Ecosystem Domain Matching, and Autofill Events
 */

import {
  encryptPayload,
  decryptPayload,
  loadStoredEnvelope,
  saveStoredEnvelope
} from '../crypto/vault-crypto.js';

let unlockedVault = null;
let activeMasterPassword = null;
let autoLockTimeoutMs = 15 * 60 * 1000; // 15 minutes default
let autoLockTimer = null;

function resetAutoLockTimer() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (unlockedVault && autoLockTimeoutMs > 0) {
    autoLockTimer = setTimeout(() => {
      lockVault();
    }, autoLockTimeoutMs);
  }
}

function lockVault() {
  unlockedVault = null;
  activeMasterPassword = null;
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
  chrome.action.setBadgeText({ text: '' });
  notifyTabsOfVaultChange();
}

function notifyTabsOfVaultChange() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        chrome.tabs.sendMessage(tab.id, { type: 'ZEROVAULT_STATE_CHANGED' }, () => {
          // Explicitly inspect chrome.runtime.lastError to suppress "Unchecked runtime.lastError: Receiving end does not exist"
          if (chrome.runtime.lastError) {
            // Content script not ready or tab restricted - ignore silently
          }
        });
      }
    });
  });
}

function extractDomain(rawUrl) {
  if (!rawUrl) return '';
  try {
    // Handle Android app credentials exported from Google Password Manager
    if (rawUrl.startsWith('android://')) {
      const match = rawUrl.match(/@([a-zA-Z0-9._-]+)/);
      if (match) return match[1].toLowerCase();
    }

    const url = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return rawUrl.toLowerCase().replace(/^www\./, '').split('/')[0];
  }
}

function getBaseDomain(domain) {
  if (!domain) return '';
  const clean = domain.toLowerCase().replace(/^www\./, '');
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;

  const multiPartTlds = [
    'co.in', 'co.uk', 'com.au', 'co.nz', 'co.za', 'com.br',
    'gov.in', 'org.uk', 'net.in', 'pages.dev', 'github.io',
    'vercel.app', 'web.app', 'appspot.com', 'firebaseapp.com'
  ];

  const lastTwo = parts.slice(-2).join('.');
  if (multiPartTlds.includes(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

// Major web ecosystem domain equivalence clusters
const DOMAIN_EQUIVALENTS = [
  ['google.com', 'gmail.com', 'youtube.com', 'google.co.in', 'google.co.uk', 'com.google.android.gm', 'com.google.android.youtube'],
  ['microsoft.com', 'live.com', 'office.com', 'outlook.com', 'microsoftonline.com', 'msn.com'],
  ['apple.com', 'icloud.com'],
  ['amazon.com', 'amazon.in', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca', 'amazon.co.jp']
];

function areDomainsEquivalent(d1, d2) {
  if (!d1 || !d2) return false;
  if (d1 === d2) return true;
  for (const group of DOMAIN_EQUIVALENTS) {
    const hasD1 = group.some((g) => d1 === g || d1.endsWith('.' + g) || g.endsWith('.' + d1));
    const hasD2 = group.some((g) => d2 === g || d2.endsWith('.' + g) || g.endsWith('.' + d2));
    if (hasD1 && hasD2) return true;
  }
  return false;
}

function isTitleMatch(entryTitle, targetDomain, targetBase) {
  if (!entryTitle) return false;
  const cleanTitle = entryTitle.toLowerCase().trim();
  if (targetDomain.includes(cleanTitle) || (targetBase && cleanTitle.includes(targetBase))) return true;

  // Split title into alphanumeric words
  const words = cleanTitle.split(/[^a-z0-9]+/i).filter(
    (w) => w.length >= 3 && !['account', 'login', 'signin', 'portal', 'website', 'online', 'user', 'the', 'app'].includes(w)
  );

  for (const word of words) {
    if (targetDomain.includes(word) || (targetBase && targetBase.includes(word))) return true;
  }
  return false;
}

function getMatchingEntries(url) {
  if (!unlockedVault || !Array.isArray(unlockedVault.entries)) return [];
  if (!url) return unlockedVault.entries;

  const targetDomain = extractDomain(url);
  const targetBase = getBaseDomain(targetDomain);
  if (!targetDomain) return unlockedVault.entries;

  return unlockedVault.entries.filter((entry) => {
    const entryDomain = extractDomain(entry.website);
    const entryBase = getBaseDomain(entryDomain);
    const entryTitle = (entry.title || '').trim();

    // 1. Direct match, subdomain match, or inverse subdomain match
    if (
      entryDomain &&
      (targetDomain === entryDomain ||
        targetDomain.endsWith('.' + entryDomain) ||
        entryDomain.endsWith('.' + targetDomain))
    ) {
      return true;
    }

    // 2. Base domain match (e.g. accounts.google.com and mail.google.com both resolve to google.com)
    if (targetBase && entryBase && targetBase === entryBase) {
      return true;
    }

    // 3. Ecosystem equivalence (e.g. gmail.com, google.com, youtube.com)
    if (areDomainsEquivalent(targetDomain, entryDomain) || areDomainsEquivalent(targetBase, entryBase)) {
      return true;
    }

    // 4. Keyword / Title match (e.g. "Google", "IRCTC", "GitHub", "Amazon")
    if (isTitleMatch(entryTitle, targetDomain, targetBase)) {
      return true;
    }

    return false;
  });
}

async function updateBadgeForTab(tabId, url) {
  if (!unlockedVault) {
    chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }

  const matches = getMatchingEntries(url);
  if (matches.length > 0) {
    chrome.action.setBadgeText({ tabId, text: String(matches.length) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#3b82f6' });
  } else {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
}

// Listen to tab activation and URL updates
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      updateBadgeForTab(tab.id, tab.url);
    }
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateBadgeForTab(tabId, tab.url);
  }
});

// Primary Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  resetAutoLockTimer();

  const handle = async () => {
    switch (message.type) {
      case 'GET_STATUS': {
        const envelope = await loadStoredEnvelope();
        return {
          hasVault: !!envelope,
          isUnlocked: !!unlockedVault,
          entryCount: unlockedVault?.entries?.length || 0
        };
      }

      case 'CREATE_VAULT': {
        const { password } = message;
        if (!password || password.length < 4) {
          throw new Error('Password must be at least 4 characters');
        }

        const pending = await chrome.storage.local.get('pending_web_entries');
        const initialEntries = (pending && Array.isArray(pending.pending_web_entries)) ? pending.pending_web_entries : [];
        if (pending?.pending_web_entries) {
          await chrome.storage.local.remove('pending_web_entries');
        }

        const initialVault = {
          schemaVersion: 1,
          vaultName: 'ZeroVault Extension',
          revision: 1,
          createdAt: new Date().toISOString(),
          entries: initialEntries
        };
        const envelope = await encryptPayload(JSON.stringify(initialVault), password);
        await saveStoredEnvelope(envelope);

        unlockedVault = initialVault;
        activeMasterPassword = password;
        resetAutoLockTimer();
        notifyTabsOfVaultChange();
        return { success: true };
      }

      case 'UNLOCK_VAULT': {
        const { password } = message;
        const envelope = await loadStoredEnvelope();
        if (!envelope) {
          throw new Error('No vault found. Create one first.');
        }
        const decryptedJson = await decryptPayload(envelope, password);
        unlockedVault = JSON.parse(decryptedJson);
        activeMasterPassword = password;

        // Auto-merge any pending web vault entries
        const pending = await chrome.storage.local.get('pending_web_entries');
        if (pending && Array.isArray(pending.pending_web_entries) && pending.pending_web_entries.length > 0) {
          const newEntries = pending.pending_web_entries;
          await chrome.storage.local.remove('pending_web_entries');

          // Merge by title/website/username
          newEntries.forEach((ne) => {
            const exists = unlockedVault.entries.some(
              (e) => (e.website === ne.website || e.title === ne.title) && e.username === ne.username
            );
            if (!exists) {
              unlockedVault.entries.push(ne);
            }
          });

          const reEncrypted = await encryptPayload(JSON.stringify(unlockedVault), password);
          await saveStoredEnvelope(reEncrypted);
        }

        resetAutoLockTimer();
        notifyTabsOfVaultChange();

        // Refresh current tab badge
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.url) {
          updateBadgeForTab(activeTab.id, activeTab.url);
        }

        return { success: true, count: unlockedVault.entries?.length || 0 };
      }

      case 'LOCK_VAULT': {
        lockVault();
        return { success: true };
      }

      case 'GET_MATCHING_LOGINS': {
        const url = message.url || (sender.tab ? sender.tab.url : '');
        const matches = getMatchingEntries(url);
        return {
          isUnlocked: !!unlockedVault,
          totalEntries: unlockedVault?.entries?.length || 0,
          matches: matches.map((m) => ({
            id: m.id,
            title: m.title,
            username: m.username,
            password: m.password,
            website: m.website
          }))
        };
      }

      case 'SAVE_CREDENTIAL': {
        if (!unlockedVault || !activeMasterPassword) {
          return { success: false, error: 'Vault is locked' };
        }

        const { title, website, username, password } = message;
        if (!username && !password) {
          return { success: false, error: 'Empty credentials' };
        }

        const domain = extractDomain(website);
        const existingIdx = unlockedVault.entries.findIndex((e) => {
          return extractDomain(e.website) === domain && (e.username || '').toLowerCase() === (username || '').toLowerCase();
        });

        const now = new Date().toISOString();
        let isNew = true;

        if (existingIdx !== -1) {
          // Update password if changed
          unlockedVault.entries[existingIdx].password = password;
          unlockedVault.entries[existingIdx].updatedAt = now;
          isNew = false;
        } else {
          // Append new entry
          unlockedVault.entries.push({
            id: 'ext-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7),
            category: 'login',
            title: title || domain || 'Saved Account',
            website: website || '',
            username: username || '',
            password: password || '',
            notes: 'Saved automatically by ZeroVault Extension',
            favorite: false,
            createdAt: now,
            updatedAt: now
          });
        }

        // Re-encrypt vault and persist
        const envelope = await encryptPayload(JSON.stringify(unlockedVault), activeMasterPassword);
        await saveStoredEnvelope(envelope);

        if (sender.tab && sender.tab.id && sender.tab.url) {
          updateBadgeForTab(sender.tab.id, sender.tab.url);
        }

        return { success: true, isNew, title: title || domain };
      }

      case 'IMPORT_CREDENTIALS': {
        if (!unlockedVault || !activeMasterPassword) {
          throw new Error('Unlock your vault before importing credentials');
        }

        const { entries } = message;
        if (!Array.isArray(entries)) {
          throw new Error('Invalid entries payload');
        }

        let added = 0;
        const now = new Date().toISOString();

        entries.forEach((e) => {
          unlockedVault.entries.push({
            id: 'imp-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7),
            category: 'login',
            title: e.title || 'Imported Account',
            website: e.website || '',
            username: e.username || '',
            password: e.password || '',
            notes: e.notes || '',
            favorite: false,
            createdAt: now,
            updatedAt: now
          });
          added++;
        });

        const envelope = await encryptPayload(JSON.stringify(unlockedVault), activeMasterPassword);
        await saveStoredEnvelope(envelope);
        return { success: true, added, total: unlockedVault.entries.length };
      }

      case 'SYNC_FROM_WEB_APP': {
        const { entries } = message;
        if (!Array.isArray(entries)) {
          return { success: false, error: 'Invalid entries payload' };
        }

        const envelope = await loadStoredEnvelope();
        if (unlockedVault && activeMasterPassword) {
          let addedCount = 0;
          entries.forEach((ne) => {
            const existingIdx = unlockedVault.entries.findIndex(
              (e) => (e.website === ne.website || e.title === ne.title) && (e.username || '').toLowerCase() === (ne.username || '').toLowerCase()
            );
            if (existingIdx !== -1) {
              unlockedVault.entries[existingIdx].password = ne.password;
              unlockedVault.entries[existingIdx].updatedAt = ne.updatedAt || new Date().toISOString();
            } else {
              unlockedVault.entries.push({
                id: ne.id || 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7),
                category: ne.category || 'login',
                title: ne.title || 'Account',
                website: ne.website || '',
                username: ne.username || '',
                password: ne.password || '',
                notes: ne.notes || '',
                favorite: !!ne.favorite,
                createdAt: ne.createdAt || new Date().toISOString(),
                updatedAt: ne.updatedAt || new Date().toISOString()
              });
              addedCount++;
            }
          });
          const newEnvelope = await encryptPayload(JSON.stringify(unlockedVault), activeMasterPassword);
          await saveStoredEnvelope(newEnvelope);
        } else {
          await chrome.storage.local.set({ pending_web_entries: entries });
        }

        notifyTabsOfVaultChange();

        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.url) {
          updateBadgeForTab(activeTab.id, activeTab.url);
        }

        return { success: true, count: entries.length };
      }

      default:
        throw new Error('Unknown message type');
    }
  };

  handle()
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ success: false, error: err.message || String(err) }));

  return true; // Keep message channel open for async response
});
