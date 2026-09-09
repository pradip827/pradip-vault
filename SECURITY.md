# Security Policy & Threat Model

ZeroVault is architected from the ground up on a **strict zero-knowledge, client-side encryption security model**. This document specifies the cryptographic architecture, threat model, implementation boundaries, memory hygiene practices, and vulnerability disclosure policies.

---

## 1. Zero-Knowledge Security Model

There is **no proprietary backend server, database, or cloud authority**. All cryptographic operations—including password hashing, key derivation, authenticated encryption, decryption, and conflict resolution—occur **exclusively inside the user's local execution environment** (browser sandboxed Web Worker or Capacitor Android native container).

```
                            ZEROVAULT ZERO-KNOWLEDGE BOUNDARY
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                                CLIENT DEVICE                                     │
  │                                                                                  │
  │   Master Password (Input)                                                        │
  │         │                                                                        │
  │         ▼                                                                        │
  │   [Isolated Web Worker] ── Argon2id (64 MiB, t=3, p=1) ──► 256-bit VEK (Volatile)│
  │                                                                │                 │
  │   Plaintext Credentials ───────────────────────────────────────┤                 │
  │         ▲                                                      ▼                 │
  │         │ (Decryption via AES-256-GCM)            (AES-256-GCM Encryption)       │
  │         │                                                      │                 │
  │   Decrypted Vault (In-Memory Signals)                          ▼                 │
  │                                                   Encrypted Envelope             │
  │                                                   (Ciphertext + AAD Metadata)    │
  └────────────────────────────────────────────────────────────────┼─────────────────┘
                                                                   │
                                 ┌─────────────────────────────────┴─────────────────┐
                                 │                 EXTERNAL STORAGE                  │
                                 │   (Encrypted Payloads Only — Zero Plaintext)      │
                                 │                                                   │
                                 │  • Local IndexedDB (zerovault_db)                 │
                                 │  • Exported Backups (.zerovault)                  │
                                 │  • Google Drive (appDataFolder sandbox)           │
                                 └───────────────────────────────────────────────────┘
```

### Absolute Zero-Knowledge Guarantees:
- Master passwords are **never** stored, transmitted over a network, or written to persistent storage.
- Plaintext credentials, secure notes, and metadata exist only in volatile RAM while the vault is unlocked.
- The remote sync engine transmits **only authenticated, encrypted envelopes**. Google Drive acts purely as an untrusted key-value storage engine.
- If Google Drive or Cloudflare Pages were fully compromised, an attacker would obtain only encrypted ciphertext blobs that cannot be decrypted without the master password.

---

## 2. Threat Model Matrix

### 2.1 Assets
1. **Master Password**: The human-remembered secret unlocking the vault.
2. **Vault Encryption Key (VEK)**: The derived 256-bit symmetric key.
3. **Decrypted Credentials**: Plaintext usernames, passwords, URLs, notes, and custom fields.
4. **Encrypted Vault Envelopes**: Ciphertext, IV, salt, and KDF metadata stored in IndexedDB or Google Drive.
5. **OAuth 2.0 Access Tokens**: Short-lived Google Identity Services bearer tokens for `appDataFolder` operations.

### 2.2 Adversaries & Mitigations

| Adversary Profile | Attack Vector | Security Mitigation / Defense |
| :--- | :--- | :--- |
| **Passive Network Eavesdropper** | Intercepts HTTP/TLS traffic between client and Cloudflare/Google. | TLS 1.3 enforced via HSTS (`max-age=63072000; includeSubDomains; preload`). Payload is already AES-256-GCM encrypted prior to transmission. |
| **Untrusted Cloud Storage (Google Drive)** | Malicious insider or compromised Google account inspects synced vault. | Only isolated `appDataFolder` is used (`drive.appdata` scope). All vault data is encrypted with Argon2id + AES-256-GCM before upload. Zero plaintext or keys ever reach Google. |
| **Active Network Attacker (Replay / Rollback)** | Captures an old encrypted envelope and replays it to revert the vault to a stale revision. | Every envelope carries a monotonically increasing `revision` number. `highestKnownRevision` is tracked locally and rejects any envelope with an equal or lower revision. |
| **Ciphertext Tamperer / Bit-Flipper** | Modifies bits in stored or in-transit ciphertext to alter decrypted data. | AES-256-GCM authenticated encryption produces a 128-bit authentication tag. RFC 8785 Canonical JSON Additional Authenticated Data (AAD) binds envelope headers. Decryption aborts instantly if any byte is altered. |
| **Offline Brute-Force Cracker** | Obtains an encrypted `.zerovault` backup and runs GPU/ASIC dictionary attacks. | High-cost Argon2id parameters ($64\text{ MiB}$ RAM, $t=3$ iterations). Highly resistant to GPU and ASIC parallelism. |

> **Note on `.zerovault` backup checksum**: The SHA-256 checksum embedded in backup files detects **accidental corruption or truncation** during storage or transfer. It is **not** a cryptographic authentication tag — an attacker with write access to the backup file can recalculate a valid checksum after modification. The actual cryptographic authenticity boundary is the **AES-256-GCM authentication tag** embedded in the ciphertext. Backup files that pass the SHA-256 check but contain a tampered ciphertext will be rejected by AES-GCM authentication during decryption.
| **Casual Device Snoop (Unattended Screen)** | Unauthorized person accesses device while user steps away. | Auto-lock engine with configurable inactivity timeout (1m, 5m, 15m, 30m, 60m), immediate lock on tab minimization / visibility change, and Android backgrounding lock via `@capacitor/app`. |
| **Malicious Clipboard Sniffer** | Third-party app reads copied credentials from system clipboard. | Automatic clipboard erasure with configurable countdown (10s, 30s, 60s, 120s) and manual "Clear Now" hygiene action. |
| **Malicious Link Injection** | Credential entry contains `javascript:` or `data:` URL attempting XSS on click. | Strict URL sanitization (`sanitizer.ts`) blocks dangerous schemes, enforces `http:`/`https:`, and mandates `rel="noopener noreferrer" target="_blank"`. |

### 2.3 Attacks Outside the Web/App Threat Model (Out-of-Scope)
No client-side software can guarantee protection against:
- **Host OS-Level Malware / Keyloggers**: If the operating system itself is infected with a ring-0 or user-space keylogger, keystrokes can be captured before reaching the browser.
- **Malicious Browser Extensions**: Extensions with full `<all_urls>` permissions can inspect DOM input trees. Users must ensure trusted extension environments.
- **Compromised Build Pipeline**: If the GitHub repository or Cloudflare Pages deployment pipeline were compromised, modified JavaScript could be delivered. Use subresource integrity, strict CSP, and self-hosted PWA verification.

---

## 3. Cryptographic Specifications

### 3.1 Key Derivation Function (KDF): Argon2id
- **Specification**: RFC 9106.
- **Implementation**: Audited WebAssembly binary via `hash-wasm` running in a dedicated `Worker` thread.
- **Production Baseline Parameters**:
  - **Memory Cost ($m$)**: $65{,}536\text{ KiB}$ ($64\text{ MiB}$)
  - **Time Cost ($t$)**: $3\text{ iterations}$
  - **Parallelism ($p$)**: $1\text{ thread}$ (Optimized for Web Worker execution)
  - **Salt**: $16\text{ bytes}$ ($128\text{ bits}$) CSPRNG via `crypto.getRandomValues()`
  - **Derived Key Length**: $32\text{ bytes}$ ($256\text{ bits}$)
- **Hard Security Floor**: Any imported backup or remote sync envelope advertising parameters below the security floor ($m < 32{,}768\text{ KiB}$, $t < 3$, $\text{salt} < 16\text{ bytes}$) is **strictly rejected** before derivation begins.

### 3.2 Symmetric Authenticated Encryption: AES-256-GCM
- **Specification**: NIST SP 800-38D.
- **Implementation**: Native W3C Web Cryptography API (`crypto.subtle`).
- **Cipher**: AES-256-GCM (`AES-GCM` with 256-bit key).
- **Initialization Vector (IV)**: $12\text{ bytes}$ ($96\text{ bits}$) generated fresh from `crypto.getRandomValues()` for **every single encryption event**. IV reuse is cryptographically impossible under normal operation (verified via automated collision tests of 10,000 continuous IV generations).
- **Authentication Tag**: $128\text{ bits}$ ($16\text{ bytes}$).
- **Additional Authenticated Data (AAD)**: RFC 8785 Canonical JSON representation of public envelope header metadata:
  ```json
  {"encryption":{"cipher":"AES-256-GCM","iv":"...","tagLength":128},"formatVersion":1,"kdf":{"algorithm":"Argon2id","params":{"iterations":3,"memory":65536,"parallelism":1},"salt":"..."}}
  ```
  Any tampering with header fields, format versions, or IVs causes AEAD verification to fail during decryption.

### 3.3 Fast In-Memory Re-Encryption
To maintain peak UI responsiveness without compromising security:
1. Upon successful vault unlock or vault creation, the derived 256-bit AES key is stored in volatile memory inside the active service layer.
2. Subsequent credential additions, modifications, and deletions re-encrypt the vault in **$< 1\text{ ms}$** using this volatile key with a **brand new 12-byte CSPRNG IV every time**.
3. When the vault is locked (manually, via inactivity timeout, or app minimization), all volatile key buffers and decrypted records are **immediately cleared and zeroized**.

### 3.4 Unbiased CSPRNG Random Generation
- **Character Password Generator**: Uses `crypto.getRandomValues()` with **rejection sampling** to ensure zero modulo bias across configurable character spaces.
- **Diceware Passphrase Generator**: Uses a standardized 2,048-word BIP-39 English dictionary where each word provides exactly $11\text{ bits}$ of Shannon entropy ($2^{11} = 2048$).

---

## 4. Storage & Memory Hygiene

### 4.1 Persistent Storage (IndexedDB)
- Database: `zerovault_db` (Version 2).
- Object Stores:
  - `encrypted_vaults`: Stores `EncryptedVaultEnvelope` records with `highestKnownRevision`.
  - `sync_store`: Stores the 3-way merge base snapshot as an **encrypted envelope** (`EncryptedVaultEnvelope`), ensuring local zero-knowledge persistence at rest.
- **Zero Plaintext Rule**: Neither plaintext credentials, unhashed passwords, nor derived keys are ever written to IndexedDB, `localStorage`, `sessionStorage`, or cookies.

### 4.2 In-Memory Hygiene & Buffer Wiping
- Typed binary buffers (`Uint8Array`, `ArrayBuffer`, `DataView`) containing cryptographic keys, salts, IVs, or raw ciphertexts are explicitly zeroed out in-place using `wipeBuffer()` (`buffer.fill(0)`).
- **JavaScript Engine Memory Limitation**: High-level JavaScript strings (e.g. `entry.password`) are immutable in modern V8 and JavaScriptCore engines and cannot be forcefully zeroed in-place. ZeroVault mitigates this by nullifying object references immediately on lock to allow immediate garbage collection.

### 4.3 Clipboard Hygiene
- When a credential is copied, an automated countdown timer (default: 30 seconds) monitors the clipboard.
- Upon timer expiration or when the user triggers "Clear Now", `@capacitor/clipboard` / `navigator.clipboard.writeText('')` clears the clipboard buffer.

---

## 5. Google Drive Sync & 3-Way Conflict Engine

- **OAuth 2.0 Isolation**: Requests strictly the restricted `https://www.googleapis.com/auth/drive.appdata` scope. ZeroVault cannot see or modify any personal user files in Google Drive.
- **Zero Token Persistence**: Access tokens are held purely in memory and are discarded on tab refresh or app termination.
- **Deterministic 3-Way Merge**:
  - Compares Base ($B$), Local ($L$), and Remote ($R$).
  - Merges non-overlapping additions and edits deterministically.
  - Resolves concurrent modifications using `updatedAt` timestamps (newest wins).
  - Ambiguous or exact timestamp collisions generate duplicate conflict safety copies (`[Title] (Sync Conflict)`), guaranteeing **zero data loss**.
- **Rollback Rejection**: If remote storage advertises a revision lower than `highestKnownRevision`, sync immediately aborts to prevent downgrade attacks.

---

## 6. Content Security Policy & Cloudflare Deployment

The production deployment on Cloudflare Pages is protected by strict HTTP headers configured in `public/_headers`:

```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Cross-Origin-Opener-Policy: same-origin-allow-popups
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.googleusercontent.com; font-src 'self'; connect-src 'self' https://accounts.google.com https://www.googleapis.com; frame-src https://accounts.google.com; manifest-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests;
```

---

---

## 8. Browser Extension Security Architecture & Trust Boundaries

The Pradip Vault browser extension operates under a multi-zone zero-trust architecture designed to protect user credentials even when running in hostile page environments:

```
                      EXTENSION THREE-ZONE TRUST ARCHITECTURE
                      
    ┌────────────────────────────────────────────────────────────────────────┐
    │                        ZONE 1: TRUSTED                                 │
    │  • Extension Background Service Worker (background.js)                │
    │  • Extension Popup UI (popup.js)                                       │
    │  • Ephemeral in-memory session only; ZERO plaintext storage            │
    │  • Zero master password handling (no activeMasterPassword)             │
    └────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ Browser Native IPC (chrome.runtime)
                                    │ Least Privilege: Metadata query & Single Credential Fill
                                    ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │                      ZONE 2: SEMI-TRUSTED                              │
    │  • Content Script (autofill.js) injected on <all_urls>                 │
    │  • In-field badge positioning and user interaction                     │
    │  • Receives ONLY metadata ({ id, title, username }) without passwords   │
    │  • Receives single password ONLY upon explicit user click              │
    │  • NO window.postMessage sync listeners; NO vault dump capabilities   │
    └────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ Isolated World Boundary
                                    ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │                       ZONE 3: UNTRUSTED                                │
    │  • Arbitrary Web Pages, DOM Scripts, Third-Party Trackers, iframes     │
    │  • ZERO access to extension APIs                                       │
    │  • Blocked from calling extension by externally_connectable            │
    │  • Cannot request, intercept, or trigger vault data                    │
    └────────────────────────────────────────────────────────────────────────┘
```

### 8.1 Why Arbitrary Websites Cannot Access the Vault
1. **Engine-Level Lockdown (`externally_connectable`)**:
   In `manifest.json`, `externally_connectable` is restricted strictly to `https://pradip-vault.pages.dev/*`. Any arbitrary website (e.g. `https://evil.com`) attempting to invoke `chrome.runtime.sendMessage` or `chrome.runtime.connect` is immediately rejected by the browser engine with a permission error before extension code executes.
2. **Elimination of `window.postMessage` Transport**:
   ZeroVault does **NOT** use `window.postMessage(..., '*')` to transmit credentials. Decrypted credentials are never emitted into the window event loop, DOM attributes, or custom events.
3. **No Full-Vault Extraction API**:
   There is no `getEntireVault()` or bulk export endpoint available to content scripts or external callers.
4. **Hostile Iframe Defense**:
   If the Web Vault is embedded in an `<iframe>`, the extension bridge is completely disabled (`window !== window.top`), defeating clickjacking and cross-origin framing attacks.

### 8.2 Autofill Protocol (Least Privilege)
1. **Field Detection**: Content script detects login input fields and injects visual lock badges.
2. **Metadata Query**: Content script requests `GET_MATCHING_METADATA`. The Service Worker verifies `sender.tab.url` and queries the authoritative Web Vault, returning **only metadata** (`{ id, title, username, website }`). **No passwords are included.**
3. **Explicit User Action**: When the user explicitly clicks a credential item in the badge dropdown, content script requests `REQUEST_CREDENTIAL_AUTOFILL` for that single `credentialId`.
4. **Strict Same-Origin Enforcement**: The Service Worker and Web Vault verify that `sender.tab.url` matches the credential's website origin using strict normalized same-origin comparison (`isOriginMatch`). Subdomains, substring matches, cousin-domain spoofing (`evilgithub.com`, `github.com.evil.com`), and protocol downgrades are strictly rejected.
5. **Single-Use Fill**: Only the single requested credential is returned. The content script immediately writes it to the DOM input, dispatches standard input/change events, and discards it from memory.

### 8.3 Autosave Protocol
1. Content script detects form submission candidates on login forms.
2. Content script displays an in-page confirmation prompt toast asking: *"Save password for [domain] in Pradip Vault?"*.
3. **Explicit Confirmation Required**: Passwords are **never silently saved**. Credentials are transmitted only when the user explicitly clicks the "Save" or "Update" button.
4. The Web Vault validates the request origin, re-encrypts the entry with Argon2id ($64\text{ MiB}$) + AES-256-GCM, and updates IndexedDB.

### 8.4 Lock Behavior & Ephemeral Sessions
- When the Web Vault locks (via timeout, tab minimization, or manual user action), it dispatches `REVOKE_AUTH_SESSION` and disconnects the native Port.
- The Extension Service Worker immediately wipes all active session references and notifies open tabs to tear down all in-field badges and dropdowns.
- **MV3 Service Worker Restarts**: In Manifest V3, background service workers terminate during idle periods. A restarted service worker starts in a **locked state by default** (`activeSession = null`) and never persists decrypted credentials to disk.

### 8.5 Security Limitations & Threat Boundaries
- **In-Memory JavaScript String Immutability**: Primitive JavaScript strings (e.g. `credential.password`) cannot be forcefully zeroed in-place in V8 memory heaps. ZeroVault mitigates this by eliminating long-lived variables and dereferencing objects immediately.
- **OS-Level Clipboard Managers**: ZeroVault attempts to clear the clipboard after 30 seconds, but OS-level clipboard history tools (e.g. Windows Clipboard History, macOS Paste) may record copied secrets outside browser sandbox control.
- **Deployment Pipeline Compromise**: "Zero-knowledge" encryption guarantees that cloud databases and storage backends (Google Drive, Cloudflare Pages) cannot read vault contents. However, zero-knowledge **does not protect against a compromised application bundle**. If the hosting infrastructure serving `https://pradip-vault.pages.dev` were compromised to deliver malicious client JavaScript, an active attacker could capture credentials before encryption. Users requiring immunity against web bundle compromise should inspect the build hash or utilize native compiled packages.

### 8.6 Legitimate-Origin Autofill Limitation (Browser Security Boundary)

When the user explicitly authorizes autofill on a legitimate origin (e.g., `https://github.com`), the decrypted password must be written into the webpage's DOM input element for authentication to proceed. This is a fundamental browser constraint shared by **all** password manager autofill implementations.

Consequently, any JavaScript running on that exact legitimate origin at the moment of fill may potentially observe the autofilled credential by reading the DOM. This includes the page's own scripts, third-party analytics, ad SDKs, or browser extensions with `<all_urls>` access.

**Exact-origin matching DOES protect against:**
- Subdomain spoofing (`login.evil.com` vs `github.com`)
- Cousin-domain attacks (`evilgithub.com`, `github.com.evil.com`)
- Protocol downgrades (`http://github.com`)
- Cross-origin iframes attempting to trigger autofill
- Wildcard path matching (only the specific page origin is authorized)

**Exact-origin matching CANNOT protect against:**
- Malicious or compromised JavaScript running **on the exact same legitimate origin** (e.g. a compromised CDN asset loaded by `github.com`)
- Browser extensions with `<all_urls>` permissions that inspect DOM state after fill

This is an inherent browser architecture limitation. ZeroVault minimizes exposure by filling only one credential per explicit user click, immediately releasing the reference from memory after DOM write, and not persisting decrypted values to any web-accessible storage.

---

## 9. Vulnerability Disclosure Policy

If you discover a security vulnerability or cryptographic flaw in ZeroVault, please report it responsibly:
- **Email**: Security reports should be directed to the repository owner via GitHub Security Advisories or private repository message.
- Please do not open public issues detailing exploitable vulnerabilities until a fix has been prepared and released.
