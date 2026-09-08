/**
 * ZeroVault In-Page Autofill & Moveable Assistant Engine
 */

(function () {
  const ZEROVAULT_SVG = `
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" fill="#070a12" stroke="#3b82f6" stroke-width="2"/>
      <path d="M16 22V17C16 12.58 19.58 9 24 9C28.42 9 32 12.58 32 17V22" stroke="#38bdf8" stroke-width="3" stroke-linecap="round"/>
      <rect x="12" y="22" width="24" height="18" rx="5" fill="#0e1424" stroke="#3b82f6" stroke-width="2"/>
      <circle cx="24" cy="29" r="3" fill="#38bdf8"/>
      <path d="M24 32V35" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round"/>
    </svg>
  `;

  let activeDropdown = null;
  let draggablePill = null;
  let isPillDismissed = false;
  let observer = null;
  let scanDebounceTimer = null;
  let isContextActive = true;

  function isRuntimeValid() {
    if (!isContextActive) return false;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        return true;
      }
    } catch (e) {}
    teardownExtension();
    return false;
  }

  function teardownExtension() {
    isContextActive = false;
    if (observer) {
      try { observer.disconnect(); } catch (e) {}
      observer = null;
    }
    if (scanDebounceTimer) {
      clearTimeout(scanDebounceTimer);
      scanDebounceTimer = null;
    }
    if (draggablePill) {
      try { draggablePill.remove(); } catch (e) {}
      draggablePill = null;
    }
    closeActiveDropdown();
    try {
      document.querySelectorAll('.zerovault-input-badge, .zerovault-dropdown, #zerovault-pill-container, #zerovault-save-toast, #zerovault-prompt-toast').forEach((el) => el.remove());
    } catch (e) {}
  }

  function safeSendMessage(message, callback) {
    if (!isRuntimeValid()) return;
    try {
      chrome.runtime.sendMessage(message, (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
          const msg = err.message || '';
          if (msg.includes('Extension context invalidated') || msg.includes('Receiving end does not exist')) {
            teardownExtension();
            return;
          }
        }
        if (typeof callback === 'function') {
          callback(res);
        }
      });
    } catch (err) {
      if (err?.message?.includes('Extension context invalidated')) {
        teardownExtension();
      }
    }
  }

  function closeActiveDropdown() {
    if (activeDropdown) {
      try { activeDropdown.remove(); } catch (e) {}
      activeDropdown = null;
    }
  }

  document.addEventListener('click', (e) => {
    if (
      activeDropdown &&
      !activeDropdown.contains(e.target) &&
      !e.target.closest('.zerovault-input-badge') &&
      !e.target.closest('.zerovault-float-pill')
    ) {
      closeActiveDropdown();
    }
  });

  // --- Strict Field & Auth Detection ---

  function isSearchOrFilterInput(input) {
    const type = (input.type || '').toLowerCase();
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const role = (input.getAttribute('role') || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();

    if (autocomplete === 'username' || autocomplete === 'email' || autocomplete === 'current-password' || autocomplete === 'new-password') {
      return false;
    }

    return (
      type === 'search' ||
      role === 'searchbox' ||
      name.includes('search') ||
      name.includes('query') ||
      name === 'q' ||
      id.includes('search') ||
      placeholder.includes('search') ||
      placeholder.includes('filter') ||
      ariaLabel.includes('search') ||
      ariaLabel.includes('filter')
    );
  }

  function isAuthPageUrl() {
    const href = window.location.href.toLowerCase();
    const hostname = window.location.hostname.toLowerCase();
    return (
      href.includes('/login') ||
      href.includes('/signin') ||
      href.includes('/sign-in') ||
      href.includes('/auth') ||
      href.includes('/session') ||
      href.includes('/identifier') ||
      hostname.includes('accounts.google.com') ||
      hostname.includes('login.microsoftonline.com') ||
      hostname.includes('appleid.apple.com') ||
      hostname.includes('auth.')
    );
  }

  function getLoginFields() {
    const isAuthPage = isAuthPageUrl();

    // 1. Visible password fields
    const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        el.offsetParent !== null &&
        !el.disabled &&
        !el.readOnly &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 30 &&
        rect.height > 12
      );
    });

    // 2. Visible username/email fields
    let usernameInputs = [];
    const hasPassword = passwordInputs.length > 0;

    // We scan for usernames if a password field is present OR if we are on a recognized auth page
    if (hasPassword || isAuthPage) {
      usernameInputs = Array.from(
        document.querySelectorAll(
          'input[type="text"], input[type="email"], input[autocomplete="username"], input[autocomplete="email"], input[id="identifierId"], input[name="identifier"], input[name*="user" i], input[name*="login" i], input[name*="email" i]'
        )
      ).filter((el) => {
        if (isSearchOrFilterInput(el)) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          el.offsetParent !== null &&
          !el.disabled &&
          !el.readOnly &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 30 &&
          rect.height > 12
        );
      });
    }

    const hasLogin = passwordInputs.length > 0 || (isAuthPage && usernameInputs.length > 0);
    return { passwordInputs, usernameInputs, hasLogin };
  }

  // --- Moveable & Draggable Floating Pill Assistant ---

  function createDraggablePill(matchesCount) {
    if (draggablePill || isPillDismissed) return;

    const pill = document.createElement('div');
    pill.className = 'zerovault-float-pill';
    pill.id = 'zerovault-assistant-pill';
    pill.innerHTML = `
      <span class="zerovault-pill-handle" title="Drag to move">⠿</span>
      <div class="zerovault-pill-logo">${ZEROVAULT_SVG}</div>
      <span class="zerovault-pill-label">ZeroVault</span>
      ${matchesCount > 0 ? `<span class="zerovault-pill-count">${matchesCount}</span>` : ''}
      <button class="zerovault-pill-close" title="Dismiss">&times;</button>
    `;

    // Restore saved drag coordinates if available
    try {
      const savedPos = JSON.parse(sessionStorage.getItem('zerovault_pill_coord') || 'null');
      if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
        pill.style.bottom = 'auto';
        pill.style.right = 'auto';
        pill.style.left = `${Math.min(window.innerWidth - 140, Math.max(10, savedPos.x))}px`;
        pill.style.top = `${Math.min(window.innerHeight - 50, Math.max(10, savedPos.y))}px`;
      }
    } catch {}

    document.body.appendChild(pill);
    draggablePill = pill;

    // Draggable Logic (Mouse & Touch)
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let hasMoved = false;

    function startDrag(clientX, clientY) {
      isDragging = true;
      hasMoved = false;
      dragStartX = clientX;
      dragStartY = clientY;

      const rect = pill.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      pill.style.bottom = 'auto';
      pill.style.right = 'auto';
      pill.style.left = `${initialLeft}px`;
      pill.style.top = `${initialTop}px`;
      pill.classList.add('is-dragging');
    }

    function moveDrag(clientX, clientY) {
      if (!isDragging) return;
      const dx = clientX - dragStartX;
      const dy = clientY - dragStartY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true;
      }

      const pillWidth = pill.offsetWidth || 120;
      const pillHeight = pill.offsetHeight || 36;
      const newLeft = Math.min(window.innerWidth - pillWidth - 10, Math.max(10, initialLeft + dx));
      const newTop = Math.min(window.innerHeight - pillHeight - 10, Math.max(10, initialTop + dy));

      pill.style.left = `${newLeft}px`;
      pill.style.top = `${newTop}px`;
    }

    function endDrag() {
      if (isDragging) {
        isDragging = false;
        pill.classList.remove('is-dragging');
        try {
          const rect = pill.getBoundingClientRect();
          sessionStorage.setItem('zerovault_pill_coord', JSON.stringify({ x: rect.left, y: rect.top }));
        } catch {}
      }
    }

    // Mouse listeners
    pill.addEventListener('mousedown', (e) => {
      if (e.target.closest('.zerovault-pill-close')) return;
      startDrag(e.clientX, e.clientY);
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      moveDrag(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', () => {
      endDrag();
    });

    // Touch listeners
    pill.addEventListener('touchstart', (e) => {
      if (e.target.closest('.zerovault-pill-close')) return;
      const touch = e.touches[0];
      if (touch) startDrag(touch.clientX, touch.clientY);
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches[0]) {
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      endDrag();
    });

    // Click handler for assistant pill
    pill.addEventListener('click', (e) => {
      if (e.target.closest('.zerovault-pill-close')) {
        pill.remove();
        draggablePill = null;
        isPillDismissed = true;
        return;
      }

      if (hasMoved) return;

      if (activeDropdown) {
        closeActiveDropdown();
        return;
      }

      safeSendMessage({ type: 'GET_MATCHING_LOGINS', url: window.location.href }, (res) => {
        if (!isRuntimeValid()) return;
        const matches = res?.matches || [];
        renderDropdownForPill(pill, matches, res?.isUnlocked, res?.totalEntries || 0);
      });
    });
  }

  // --- Moveable In-Field Lock Badge ---

  function attachBadgeToInput(input) {
    if (input.dataset.zerovaultAttached) return;
    input.dataset.zerovaultAttached = 'true';

    const badge = document.createElement('div');
    badge.className = 'zerovault-input-badge';
    badge.innerHTML = ZEROVAULT_SVG;
    badge.title = 'ZeroVault Autofill (Drag to move)';
    document.body.appendChild(badge);

    let isDetached = false;
    let badgeMoved = false;

    function updateBadgePosition() {
      if (isDetached) return;
      const rect = input.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        badge.classList.remove('visible');
        return;
      }
      badge.style.top = `${rect.top + window.scrollY + (rect.height / 2) - 11}px`;
      badge.style.left = `${rect.left + window.scrollX + rect.width - 28}px`;
    }

    // Position badge immediately and bind scroll/resize
    updateBadgePosition();
    window.addEventListener('scroll', updateBadgePosition, { passive: true });
    window.addEventListener('resize', updateBadgePosition, { passive: true });

    // Show suggestions dropdown automatically on input focus
    input.addEventListener('focus', () => {
      updateBadgePosition();
      safeSendMessage({ type: 'GET_MATCHING_LOGINS', url: window.location.href }, (res) => {
        if (!isRuntimeValid()) return;
        if (res?.matches?.length > 0 && !activeDropdown) {
          renderDropdownForInput(input, badge, res.matches, res.isUnlocked, res.totalEntries || 0);
        }
      });
    });

    input.addEventListener('click', () => {
      updateBadgePosition();
      if (!activeDropdown) {
        safeSendMessage({ type: 'GET_MATCHING_LOGINS', url: window.location.href }, (res) => {
          if (!isRuntimeValid()) return;
          if (res?.matches?.length > 0 && !activeDropdown) {
            renderDropdownForInput(input, badge, res.matches, res.isUnlocked, res.totalEntries || 0);
          }
        });
      }
    });

    // Make badge moveable / draggable
    let isBadgeDragging = false;
    let bStartX = 0;
    let bStartY = 0;
    let bInitLeft = 0;
    let bInitTop = 0;

    badge.addEventListener('mousedown', (e) => {
      isBadgeDragging = true;
      badgeMoved = false;
      bStartX = e.clientX;
      bStartY = e.clientY;

      const rect = badge.getBoundingClientRect();
      bInitLeft = rect.left + window.scrollX;
      bInitTop = rect.top + window.scrollY;

      badge.style.left = `${bInitLeft}px`;
      badge.style.top = `${bInitTop}px`;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isBadgeDragging) return;
      const dx = e.clientX - bStartX;
      const dy = e.clientY - bStartY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        badgeMoved = true;
        isDetached = true;
      }

      badge.style.left = `${bInitLeft + dx}px`;
      badge.style.top = `${bInitTop + dy}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isBadgeDragging) {
        isBadgeDragging = false;
      }
    });

    // Double-click badge to reset position back to input
    badge.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isDetached = false;
      updateBadgePosition();
    });

    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (badgeMoved) return;

      safeSendMessage({ type: 'GET_MATCHING_LOGINS', url: window.location.href }, (res) => {
        if (!isRuntimeValid()) return;
        renderDropdownForInput(input, badge, res?.matches || [], res?.isUnlocked, res?.totalEntries || 0);
      });
    });
  }

  function renderDropdownForInput(input, badge, matches, isUnlocked, totalEntries) {
    closeActiveDropdown();

    const rect = badge.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'zerovault-dropdown';
    dropdown.style.top = `${rect.bottom + window.scrollY + 6}px`;
    dropdown.style.left = `${Math.max(10, rect.left + window.scrollX - 120)}px`;

    dropdown.innerHTML = buildDropdownHtml(matches, isUnlocked, totalEntries);
    document.body.appendChild(dropdown);
    activeDropdown = dropdown;

    bindDropdownActions(dropdown, input, matches);
  }

  function renderDropdownForPill(pill, matches, isUnlocked, totalEntries) {
    closeActiveDropdown();

    const rect = pill.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'zerovault-dropdown';

    // Position above or below pill
    if (rect.top > 250) {
      dropdown.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      dropdown.style.top = 'auto';
    } else {
      dropdown.style.top = `${rect.bottom + 8}px`;
      dropdown.style.bottom = 'auto';
    }
    dropdown.style.left = `${Math.max(10, Math.min(window.innerWidth - 270, rect.left))}px`;

    dropdown.innerHTML = buildDropdownHtml(matches, isUnlocked, totalEntries);
    document.body.appendChild(dropdown);
    activeDropdown = dropdown;

    const { passwordInputs, usernameInputs } = getLoginFields();
    const targetInput = passwordInputs[0] || usernameInputs[0];
    bindDropdownActions(dropdown, targetInput, matches);
  }

  function buildDropdownHtml(matches, isUnlocked, totalEntries) {
    const domain = window.location.hostname.replace(/^www\./, '');

    let html = `<div class="zerovault-dropdown-header">
      <span>ZeroVault Logins</span>
      <span>${matches.length} found</span>
    </div>`;

    if (!isUnlocked) {
      html += `
        <div class="zerovault-dropdown-empty">
          🔒 <strong>Vault is Locked</strong><br>
          <span style="font-size:11px;">Click the ZeroVault toolbar icon to unlock.</span>
        </div>
      `;
    } else if (matches.length === 0) {
      html += `
        <div class="zerovault-dropdown-empty">
          No saved logins for <strong>${escapeHtml(domain)}</strong>.<br>
          ${
            totalEntries === 0
              ? '<small style="color:#3b82f6; font-weight:600;">Vault is empty. Click extension icon to import passwords!</small>'
              : '<small>Log in to auto-save, or search in toolbar popup.</small>'
          }
        </div>
      `;
    } else {
      matches.forEach((m, idx) => {
        html += `
          <div class="zerovault-dropdown-item" data-idx="${idx}">
            <span class="zerovault-item-user">${escapeHtml(m.username || 'No Username')}</span>
            <span class="zerovault-item-title">${escapeHtml(m.title || domain)}</span>
          </div>
        `;
      });
    }

    return html;
  }

  function bindDropdownActions(dropdown, input, matches) {
    dropdown.querySelectorAll('.zerovault-dropdown-item').forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.idx, 10);
        const cred = matches[idx];
        if (cred) {
          applyFill(input, cred);
        }
        closeActiveDropdown();
      });
    });
  }

  // --- Robust Autofill Value Injection ---

  function applyFill(triggeredInput, cred) {
    const { passwordInputs, usernameInputs } = getLoginFields();

    let userField = usernameInputs[0];
    if (triggeredInput && triggeredInput.type !== 'password') {
      userField = triggeredInput;
    }
    if (userField && cred.username) {
      setFieldValue(userField, cred.username);
    }

    let passField = passwordInputs[0];
    if (triggeredInput && triggeredInput.type === 'password') {
      passField = triggeredInput;
    }
    if (passField && cred.password) {
      setFieldValue(passField, cred.password);
    }

    showPromptToast('Autofilled by ZeroVault', `Account: ${cred.username || cred.title}`);
  }

  function setFieldValue(field, value) {
    if (!field || value === undefined || value === null) return;
    field.focus();

    // Call native setter to bypass framework interceptors (React 16+, Angular, Vue)
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(field, value);
    } else {
      field.value = value;
    }

    // Dispatch synthetic event chain
    field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true }));
    field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true }));
  }

  // --- Autosave Engine ---

  function interceptFormSubmissions() {
    document.addEventListener(
      'submit',
      (e) => {
        const form = e.target;
        if (!form || !(form instanceof HTMLFormElement)) return;

        const { passwordInputs, usernameInputs } = getLoginFields();
        if (passwordInputs.length === 0) return;

        const password = passwordInputs[0].value;
        const username = usernameInputs[0] ? usernameInputs[0].value : '';

        if (password && password.length >= 2) {
          handleCapturedLogin(username, password);
        }
      },
      true
    );

    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target.closest('button, input[type="submit"]');
        if (!btn) return;

        const btnText = (btn.innerText || btn.value || '').toLowerCase();
        const isLoginAction =
          btnText.includes('log in') ||
          btnText.includes('sign in') ||
          btnText.includes('register') ||
          btnText.includes('continue') ||
          btnText.includes('submit') ||
          btnText.includes('next');

        if (isLoginAction) {
          setTimeout(() => {
            const { passwordInputs, usernameInputs } = getLoginFields();
            if (passwordInputs.length > 0 && passwordInputs[0].value) {
              handleCapturedLogin(usernameInputs[0] ? usernameInputs[0].value : '', passwordInputs[0].value);
            }
          }, 150);
        }
      },
      true
    );
  }

  function handleCapturedLogin(username, password) {
    if (!password || password.length < 3) return;
    const hostname = window.location.hostname.replace(/^www\./, '');
    showAutosavePrompt(hostname, username, password);
  }

  function showAutosavePrompt(hostname, username, password) {
    const existing = document.querySelector('.zerovault-autosave-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'zerovault-autosave-toast';
    toast.innerHTML = `
      <div class="zerovault-toast-head">
        <div class="zerovault-toast-logo">${ZEROVAULT_SVG}</div>
        <span class="zerovault-toast-title">Save to ZeroVault?</span>
        <button class="zerovault-toast-close">&times;</button>
      </div>
      <div class="zerovault-toast-body">
        Save credentials for <strong>${escapeHtml(hostname)}</strong>?<br>
        <span style="color: #64748b;">User: ${escapeHtml(username || 'Default')}</span>
      </div>
      <div class="zerovault-toast-actions">
        <button class="zerovault-btn zerovault-btn-secondary" id="zv-btn-never">Never</button>
        <button class="zerovault-btn zerovault-btn-primary" id="zv-btn-save">Save Password</button>
      </div>
    `;

    document.body.appendChild(toast);

    toast.querySelector('.zerovault-toast-close').onclick = () => toast.remove();
    toast.querySelector('#zv-btn-never').onclick = () => toast.remove();

    toast.querySelector('#zv-btn-save').onclick = () => {
      toast.querySelector('#zv-btn-save').innerText = 'Saving...';
      safeSendMessage(
        {
          type: 'SAVE_CREDENTIAL',
          title: hostname,
          website: window.location.origin,
          username,
          password
        },
        (res) => {
          if (res && res.success) {
            toast.innerHTML = `
              <div style="display:flex; align-items:center; gap:8px; color:#10b981; font-weight:600; font-size:13px;">
                <span>✓ Password saved to ZeroVault!</span>
              </div>
            `;
            setTimeout(() => toast.remove(), 2000);
          } else {
            toast.innerHTML = `
              <div style="color:#ef4444; font-size:12px;">
                ${escapeHtml(res?.error || 'Vault is locked. Unlock via toolbar icon.')}
              </div>
            `;
            setTimeout(() => toast.remove(), 3500);
          }
        }
      );
    };
  }

  function showPromptToast(title, message) {
    const existing = document.querySelector('.zerovault-prompt-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'zerovault-autosave-toast zerovault-prompt-toast';
    toast.style.width = '260px';
    toast.innerHTML = `
      <div class="zerovault-toast-head">
        <div class="zerovault-toast-logo">${ZEROVAULT_SVG}</div>
        <span class="zerovault-toast-title" style="font-size:13px;">${escapeHtml(title)}</span>
        <button class="zerovault-toast-close">&times;</button>
      </div>
      <div class="zerovault-toast-body" style="margin-bottom:0;">
        ${escapeHtml(message)}
      </div>
    `;
    document.body.appendChild(toast);
    toast.querySelector('.zerovault-toast-close').onclick = () => toast.remove();
    setTimeout(() => toast.remove(), 3000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- External Message Listener (from Popup / Background) ---

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!isRuntimeValid()) return;
        if (msg.type === 'ZEROVAULT_STATE_CHANGED') {
          triggerScan();
        } else if (msg.type === 'AUTOFILL_CREDENTIAL' && msg.credential) {
          applyFill(null, msg.credential);
          sendResponse({ success: true });
        } else if (msg.type === 'TRIGGER_WEB_SYNC') {
          window.postMessage({ type: 'ZEROVAULT_REQUEST_SYNC' }, '*');
          sendResponse({ success: true });
        }
      });
    }
  } catch (e) {}

  // --- Web App Live Sync Bridge ---
  window.addEventListener('message', (event) => {
    if (!isRuntimeValid()) return;
    if (event.data?.type === 'ZEROVAULT_WEB_VAULT_SYNC' && Array.isArray(event.data.entries)) {
      safeSendMessage({
        type: 'SYNC_FROM_WEB_APP',
        entries: event.data.entries
      }, (res) => {
        if (res?.success) {
          showPromptToast('ZeroVault Live Sync', `Synced ${res.count} accounts from Web Vault!`);
        }
      });
    }
  });

  const isWebVaultDomain = window.location.hostname.includes('pradip-vault.pages.dev') || window.location.hostname === 'localhost';
  if (isWebVaultDomain) {
    setTimeout(() => {
      if (isRuntimeValid()) {
        window.postMessage({ type: 'ZEROVAULT_REQUEST_SYNC' }, '*');
      }
    }, 600);
  }

  // --- Main Scan Routine ---

  function scanPage() {
    if (!isRuntimeValid()) return;
    const { passwordInputs, usernameInputs, hasLogin } = getLoginFields();

    // If NOT a login form or auth page, DO NOT show anything
    if (!hasLogin) {
      if (draggablePill) {
        draggablePill.remove();
        draggablePill = null;
      }
      return;
    }

    // Attach in-field focus badges
    passwordInputs.forEach((p) => attachBadgeToInput(p));
    usernameInputs.forEach((u) => attachBadgeToInput(u));

    // Show moveable assistant pill
    safeSendMessage({ type: 'GET_MATCHING_LOGINS', url: window.location.href }, (res) => {
      if (!isRuntimeValid()) return;
      createDraggablePill(res?.matches?.length || 0);
    });
  }

  function triggerScan() {
    if (!isRuntimeValid()) return;
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(() => {
      scanPage();
    }, 60);
  }

  // Initialize
  scanPage();
  interceptFormSubmissions();

  observer = new MutationObserver(() => {
    if (!isRuntimeValid()) return;
    triggerScan();
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
})();
