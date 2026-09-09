/**
 * ZeroVault Extension - Dedicated Web Vault Bridge Script
 * Scoped strictly to https://pradip-vault.pages.dev/*
 *
 * Exposes the extension runtime ID to the authorized Web Vault
 * without transmitting any credentials or using window.postMessage.
 */
(() => {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      document.documentElement.dataset.zerovaultExtensionId = chrome.runtime.id;
      window.dispatchEvent(
        new CustomEvent('zerovault-extension-ready', {
          detail: { extensionId: chrome.runtime.id }
        })
      );
    }
  } catch {
    // Isolated execution context error protection
  }
})();
