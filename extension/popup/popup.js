/**
 * ZeroVault Extension - Popup Controller
 */

// DOM Elements
const viewLocked = document.getElementById('view-locked');
const viewUnlocked = document.getElementById('view-unlocked');
const badgeStatus = document.getElementById('badge-status');
const btnLock = document.getElementById('btn-lock');

const formUnlock = document.getElementById('form-unlock');
const inputPassword = document.getElementById('input-password');
const unlockError = document.getElementById('unlock-error');

const labelCurrentDomain = document.getElementById('label-current-domain');
const listTabMatches = document.getElementById('list-tab-matches');
const inputSearch = document.getElementById('input-search');
const listAllMatches = document.getElementById('list-all-matches');
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

// Import Elements
const inputCsvImport = document.getElementById('input-csv-import');
const importStatusMsg = document.getElementById('import-status-msg');

let activeTabUrl = '';
let activeTabDomain = '';
let allVaultMatches = [];

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    activeTabUrl = tab.url;
    activeTabDomain = extractDomain(tab.url);
    labelCurrentDomain.innerText = activeTabDomain || 'Unknown Site';
  }

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
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
  inputPassword.value = '';
  unlockError.style.display = 'none';
  setTimeout(() => inputPassword.focus(), 100);
}

function showUnlockedView() {
  viewLocked.style.display = 'none';
  viewUnlocked.style.display = 'flex';
  badgeStatus.className = 'badge badge-unlocked';
  badgeStatus.innerText = 'Unlocked';
  btnLock.style.display = 'flex';

  loadCredentialsForTab();
}

function loadCredentialsForTab() {
  chrome.runtime.sendMessage({ type: 'GET_MATCHING_LOGINS', url: activeTabUrl }, (res) => {
    if (!res || !res.isUnlocked) {
      showLockedView();
      return;
    }

    const matches = res.matches || [];
    renderTabMatches(matches, res.totalEntries || 0);

    // Request all entries for search
    chrome.runtime.sendMessage({ type: 'GET_MATCHING_LOGINS', url: '' }, (allRes) => {
      allVaultMatches = allRes?.matches || [];
      labelEntryCount.innerText = `${allVaultMatches.length} items`;
      renderAllMatches(allVaultMatches);
    });
  });
}

function renderTabMatches(matches, totalEntries) {
  listTabMatches.innerHTML = '';
  if (matches.length === 0) {
    if (totalEntries === 0) {
      listTabMatches.innerHTML = `
        <div class="empty-state">
          Vault is empty.<br>
          <span style="color:#3b82f6;">Click "Import Google Passwords" below to load your passwords!</span>
        </div>
      `;
    } else {
      listTabMatches.innerHTML = `
        <div class="empty-state">
          No matches for <strong>${escapeHtml(activeTabDomain)}</strong> (${totalEntries} total saved).<br>
          <small>Search below to fill any account.</small>
        </div>
      `;
    }
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

    el.querySelector('.btn-fill').onclick = () => fillActiveTab(m);
    el.querySelector('.btn-copy-user').onclick = (e) => copyToClipboard(m.username, e.target);
    el.querySelector('.btn-copy-pass').onclick = (e) => copyToClipboard(m.password, e.target);

    listTabMatches.appendChild(el);
  });
}

function renderAllMatches(entries) {
  listAllMatches.innerHTML = '';
  if (entries.length === 0) {
    listAllMatches.innerHTML = `<div class="empty-state">No credentials found.</div>`;
    return;
  }

  entries.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'credential-item';
    el.innerHTML = `
      <div class="item-info">
        <span class="item-user">${escapeHtml(m.username || 'No Username')}</span>
        <span class="item-title">${escapeHtml(m.title || m.website || 'Account')}</span>
      </div>
      <div class="item-actions">
        <button class="btn btn-primary btn-sm btn-fill">Fill</button>
        <button class="icon-btn btn-copy-user" title="Copy Username">👤</button>
        <button class="icon-btn btn-copy-pass" title="Copy Password">🔑</button>
      </div>
    `;

    el.querySelector('.btn-fill').onclick = () => fillActiveTab(m);
    el.querySelector('.btn-copy-user').onclick = (e) => copyToClipboard(m.username, e.target);
    el.querySelector('.btn-copy-pass').onclick = (e) => copyToClipboard(m.password, e.target);

    listAllMatches.appendChild(el);
  });
}

async function fillActiveTab(credential) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  // Send message directly to content script
  chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL_CREDENTIAL', credential }, (res) => {
    // Fallback if content script was not ready
    if (chrome.runtime.lastError || !res?.success) {
      if (chrome.scripting) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (cred) => {
            const passInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(el => el.offsetParent !== null);
            const userInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input[autocomplete="username"], input[id="identifierId"]')).filter(el => el.offsetParent !== null);

            function setVal(field, val) {
              if (!field || !val) return;
              field.focus();
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (setter) setter.call(field, val);
              else field.value = val;
              field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            }

            if (userInputs[0] && cred.username) setVal(userInputs[0], cred.username);
            if (passInputs[0] && cred.password) setVal(passInputs[0], cred.password);
          },
          args: [credential]
        }).catch(() => {});
      }
    }
  });

  setTimeout(() => window.close(), 150);
}

function copyToClipboard(text, btnElement) {
  if (!text) return;
  navigator.clipboard.writeText(text);
  const orig = btnElement.innerText;
  btnElement.innerText = '✓';
  setTimeout(() => {
    btnElement.innerText = orig;
  }, 1200);
}

function setupEvents() {
  // Unlock Submit
  formUnlock.onsubmit = (e) => {
    e.preventDefault();
    const pwd = inputPassword.value;
    if (!pwd) return;

    unlockError.style.display = 'none';

    chrome.runtime.sendMessage({ type: 'UNLOCK_VAULT', password: pwd }, (res) => {
      if (res && res.success) {
        showUnlockedView();
      } else {
        if (res?.error && res.error.includes('No vault found')) {
          chrome.runtime.sendMessage({ type: 'CREATE_VAULT', password: pwd }, (cRes) => {
            if (cRes && cRes.success) {
              showUnlockedView();
            } else {
              showUnlockError(cRes?.error || 'Failed to initialize vault');
            }
          });
        } else {
          showUnlockError('Incorrect master password');
        }
      }
    });
  };

  btnLock.onclick = () => {
    chrome.runtime.sendMessage({ type: 'LOCK_VAULT' }, () => {
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
    copyToClipboard(genPasswordOutput.value, btnGenCopy);
  };

  inputSearch.oninput = () => {
    const q = inputSearch.value.trim().toLowerCase();
    if (!q) {
      renderAllMatches(allVaultMatches);
      return;
    }
    const filtered = allVaultMatches.filter(
      (m) =>
        (m.title || '').toLowerCase().includes(q) ||
        (m.username || '').toLowerCase().includes(q) ||
        (m.website || '').toLowerCase().includes(q) ||
        (m.notes || '').toLowerCase().includes(q)
    );
    renderAllMatches(filtered);
  };

  // CSV / JSON File Import Handler
  inputCsvImport.onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = (reader.result || '').trim();
        let parsedEntries = [];

        if (text.startsWith('{') || text.startsWith('[')) {
          // Parse JSON
          const json = JSON.parse(text);
          const rawList = Array.isArray(json) ? json : (json.entries || []);
          parsedEntries = rawList.map((item) => ({
            title: item.title || item.name || 'Saved Account',
            website: item.website || item.url || '',
            username: item.username || item.user || item.email || '',
            password: item.password || item.pass || '',
            notes: item.notes || item.note || ''
          })).filter(item => item.username || item.password || item.website);
        } else {
          // Parse CSV
          parsedEntries = parseGoogleCsv(text);
        }

        if (parsedEntries.length === 0) {
          showImportStatus('No valid credentials found in file', true);
          return;
        }

        chrome.runtime.sendMessage({ type: 'IMPORT_CREDENTIALS', entries: parsedEntries }, (res) => {
          if (res && res.success) {
            showImportStatus(`✓ Imported ${res.added} credentials!`, false);
            loadCredentialsForTab();
          } else {
            showImportStatus(res?.error || 'Failed to import', true);
          }
        });
      } catch (err) {
        showImportStatus(err.message || 'Invalid file format', true);
      }
    };
    reader.readAsText(file);
  };
}

function showImportStatus(msg, isError) {
  importStatusMsg.style.display = 'block';
  importStatusMsg.style.color = isError ? '#ef4444' : '#10b981';
  importStatusMsg.innerText = msg;
  setTimeout(() => {
    importStatusMsg.style.display = 'none';
  }, 4000);
}

function parseGoogleCsv(text) {
  const lines = parseCsvRows(text);
  if (lines.length < 2) throw new Error('CSV is empty');

  const headers = lines[0].map(h => h.trim().toLowerCase());
  const nameIdx = headers.findIndex(h => h === 'name' || h === 'title');
  const urlIdx = headers.findIndex(h => h === 'url' || h === 'website');
  const userIdx = headers.findIndex(h => h === 'username' || h === 'user' || h === 'login' || h === 'email');
  const passIdx = headers.findIndex(h => h === 'password' || h === 'pass');
  const noteIdx = headers.findIndex(h => h === 'note' || h === 'notes');

  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row || row.length === 0 || (row.length === 1 && !row[0].trim())) continue;

    const titleRaw = (nameIdx !== -1 && row[nameIdx] ? row[nameIdx] : '').trim();
    const url = (urlIdx !== -1 && row[urlIdx] ? row[urlIdx] : '').trim();
    const username = (userIdx !== -1 && row[userIdx] ? row[userIdx] : '').trim();
    const password = (passIdx !== -1 && row[passIdx] ? row[passIdx] : '');
    const notes = (noteIdx !== -1 && row[noteIdx] ? row[noteIdx] : '').trim();

    if (!titleRaw && !url && !username && !password) continue;

    let title = titleRaw;
    if (!title && url) {
      try {
        const u = new URL(url.startsWith('http') ? url : 'https://' + url);
        title = u.hostname.replace(/^www\./, '');
      } catch {
        title = url;
      }
    }

    entries.push({
      title: title || 'Saved Account',
      website: url,
      username,
      password,
      notes
    });
  }

  return entries;
}

function parseCsvRows(text) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
      } else if (char !== '\r') {
        currentField += char;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

function generatePassword() {
  const len = parseInt(sliderGenLen.value, 10) || 20;
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*()-_=+';
  const array = new Uint32Array(len);
  crypto.getRandomValues(array);
  let pwd = '';
  for (let i = 0; i < len; i++) {
    pwd += chars[array[i] % chars.length];
  }
  genPasswordOutput.value = pwd;
}

function showUnlockError(msg) {
  unlockError.innerText = msg;
  unlockError.style.display = 'block';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', init);
