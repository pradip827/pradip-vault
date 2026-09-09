/**
 * ZeroVault Extension - Popup Controller
 * Authenticated Companion UI for Pradip Vault
 */

// DOM Elements
const viewLocked = document.getElementById('view-locked');
const viewUnlocked = document.getElementById('view-unlocked');
const badgeStatus = document.getElementById('badge-status');
const btnLock = document.getElementById('btn-lock');
const btnOpenWebVault = document.getElementById('btn-open-web-vault');

const labelCurrentDomain = document.getElementById('label-current-domain');
const listTabMatches = document.getElementById('list-tab-matches');
const inputSearch = document.getElementById('input-search');
const labelEntryCount = document.getElementById('label-entry-count');

// Generator Elements
const btnToggleGen = document.getElementById('btn-toggle-gen');
const generatorBody = document.getElementById('generator-body');
const genArrow = document.getElementById('gen-arrow');
const genPasswordOutput = document.getElementById('gen-password-output');
const btnGenRefresh = document.getElementById('btn-gen-refresh');
const btnGenCopy = document.getElementById('btn-gen-copy');
const sliderGenLen = document.getElementById('slider-gen-len');
const labelGenLen = document.getElementById('label-gen-len');

let activeTabUrl = '';
let activeTabDomain = '';
let currentTabMatches = [];
let clipboardClearTimer = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    activeTabUrl = tab.url;
    activeTabDomain = extractDomain(tab.url);
    labelCurrentDomain.innerText = activeTabDomain || 'Current Page';
  }

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.isUnlocked) {
      showUnlockedView();
    } else {
      showLockedView();
    }
  });

  setupEvents();
  generatePassword();
}

function extractDomain(rawUrl) {
  try {
    const url = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function showLockedView() {
  viewLocked.style.display = 'flex';
  viewUnlocked.style.display = 'none';
  badgeStatus.className = 'badge badge-locked';
  badgeStatus.innerText = 'Locked';
  btnLock.style.display = 'none';
}

function showUnlockedView() {
  viewLocked.style.display = 'none';
  viewUnlocked.style.display = 'flex';
  badgeStatus.className = 'badge badge-unlocked';
  badgeStatus.innerText = 'Connected';
  btnLock.style.display = 'flex';

  loadCredentialsForTab();
}

function loadCredentialsForTab() {
  chrome.runtime.sendMessage({ type: 'GET_MATCHING_METADATA', url: activeTabUrl }, (res) => {
    if (chrome.runtime.lastError) return;
    if (!res || !res.isUnlocked) {
      showLockedView();
      return;
    }

    currentTabMatches = res.matches || [];
    labelEntryCount.innerText = `${currentTabMatches.length} items`;
    renderTabMatches(currentTabMatches);
  });
}

function renderTabMatches(matches) {
  listTabMatches.innerHTML = '';
  if (matches.length === 0) {
    listTabMatches.innerHTML = `
      <div class="empty-state">
        No saved logins for <strong>${escapeHtml(activeTabDomain)}</strong>.<br>
        <small style="color:#64748b;">Log in on this website to save credentials to Pradip Vault.</small>
      </div>
    `;
    return;
  }

  matches.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'credential-item';
    el.innerHTML = `
      <div class="item-info">
        <span class="item-user">${escapeHtml(m.username || 'No Username')}</span>
        <span class="item-title">${escapeHtml(m.title || activeTabDomain)}</span>
      </div>
      <div class="item-actions">
        <button class="btn btn-primary btn-sm btn-fill">Fill</button>
        <button class="icon-btn btn-copy-user" title="Copy Username">👤</button>
        <button class="icon-btn btn-copy-pass" title="Copy Password">🔑</button>
      </div>
    `;

    el.querySelector('.btn-fill').onclick = () => fillActiveTab(m.id);
    el.querySelector('.btn-copy-user').onclick = (e) => copyTextToClipboard(m.username, e.target);
    el.querySelector('.btn-copy-pass').onclick = (e) => copyPasswordToClipboard(m.id, e.target);

    listTabMatches.appendChild(el);
  });
}

async function fillActiveTab(credentialId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url) return;

  // Request single credential from background for this tab
  chrome.runtime.sendMessage({ type: 'REQUEST_CREDENTIAL_AUTOFILL', credentialId, tabUrl: tab.url }, (res) => {
    if (chrome.runtime.lastError || !res?.success || !res?.credential) {
      return;
    }

    // Send single credential to authenticated content script for immediate DOM fill
    chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL_CREDENTIAL', credential: res.credential }, () => {
      // Content script verifies sender, checks strict origin match, and executes in-field fill
    });

    setTimeout(() => window.close(), 150);
  });
}

function copyTextToClipboard(text, btnElement) {
  if (!text) return;
  navigator.clipboard.writeText(text);
  const orig = btnElement.innerText;
  btnElement.innerText = '✓';
  setTimeout(() => {
    btnElement.innerText = orig;
  }, 1200);
}

async function copyPasswordToClipboard(credentialId, btnElement) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url || '';
  chrome.runtime.sendMessage({ type: 'REQUEST_CREDENTIAL_AUTOFILL', credentialId, tabUrl }, (res) => {
    if (chrome.runtime.lastError || !res?.success || !res?.credential?.password) {
      return;
    }

    navigator.clipboard.writeText(res.credential.password);
    const orig = btnElement.innerText;
    btnElement.innerText = '✓';
    setTimeout(() => {
      btnElement.innerText = orig;
    }, 1200);

    // Schedule clipboard auto-clear after 30 seconds (best effort)
    if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
    clipboardClearTimer = setTimeout(() => {
      try {
        navigator.clipboard.writeText('');
      } catch {}
    }, 30000);
  });
}

function setupEvents() {
  btnOpenWebVault.onclick = async () => {
    const tabs = await chrome.tabs.query({});
    const vaultTab = tabs.find((t) => t.url && t.url.includes('pradip-vault.pages.dev'));
    if (vaultTab && vaultTab.id) {
      chrome.tabs.update(vaultTab.id, { active: true });
    } else {
      chrome.tabs.create({ url: 'https://pradip-vault.pages.dev' });
    }
    window.close();
  };

  btnLock.onclick = () => {
    chrome.runtime.sendMessage({ type: 'LOCK_SESSION' }, () => {
      showLockedView();
    });
  };

  btnToggleGen.onclick = () => {
    const isHidden = generatorBody.style.display === 'none';
    generatorBody.style.display = isHidden ? 'block' : 'none';
    genArrow.innerText = isHidden ? '▲' : '▼';
  };

  btnGenRefresh.onclick = generatePassword;
  sliderGenLen.oninput = () => {
    labelGenLen.innerText = sliderGenLen.value;
    generatePassword();
  };

  btnGenCopy.onclick = () => {
    copyTextToClipboard(genPasswordOutput.value, btnGenCopy);
  };

  inputSearch.oninput = () => {
    const q = inputSearch.value.trim().toLowerCase();
    if (!q) {
      renderTabMatches(currentTabMatches);
      return;
    }
    const filtered = currentTabMatches.filter(
      (m) => (m.title || '').toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q)
    );
    renderTabMatches(filtered);
  };
}

function generatePassword() {
  const len = parseInt(sliderGenLen.value, 10) || 20;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+~|}{[]:;?><,./-=';
  const array = new Uint32Array(len);
  crypto.getRandomValues(array);
  let pwd = '';
  for (let i = 0; i < len; i++) {
    pwd += chars[array[i] % chars.length];
  }
  genPasswordOutput.value = pwd;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Auto-reload when background signals state changes
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ZEROVAULT_STATE_CHANGED') {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
      if (res && res.isUnlocked) {
        showUnlockedView();
      } else {
        showLockedView();
      }
    });
  }
});

init();
