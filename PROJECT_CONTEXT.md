# ZeroVault: Project Context & Architectural Source of Truth

> **Instructions for AI / Developers Continuing This Project:**
> 
> You are continuing an existing project called **ZeroVault**. Treat this document as the **immutable source of truth** for all architectural, cryptographic, and design decisions already made.
> 
> **CRITICAL RULES:**
> 1. **Do NOT restart the architecture discussion.**
> 2. **Do NOT switch Angular to React.** The project is built with Angular (standalone components + Signals).
> 3. **Do NOT replace Capacitor.** The mobile wrapper is Capacitor targeting Android (`android/`). iOS is explicitly out of scope.
> 4. **Do NOT implement future phases early.** Work in strict phases.
> 5. **Do NOT weaken or simplify security requirements.**
> 6. **Do NOT create fake encryption or mock crypto.** Real cryptography must follow the specifications below.
> 7. **Do NOT store plaintext passwords or master passwords anywhere.**
> 8. **Preserve existing Phase 1 work.** Inspect existing code before making modifications.
> 9. **Current project state:** **All 10 phases are complete and verified.** Project rebranded to generic **ZeroVault**.

---

## 1. Project Identity & Purpose

- **Repository**: `example/zerovault`
- **Application Name**: ZeroVault
- **Goal**: A zero-knowledge, client-side encrypted personal password manager that operates entirely in the browser and as an Android app with **no proprietary backend server**.
- **Supported Targets**:
  - **Web/PWA**: Deployed as static assets to **Cloudflare Pages**.
  - **Native Mobile**: Packaged for **Android** via **Capacitor**.
  - *(Note: iOS native packaging was explicitly excluded by user request).*

```
                     ZEROVAULT
                          │
               Angular + TypeScript
                          │
               ┌──────────┴──────────┐
               │                     │
           Web/PWA                Capacitor
               │                     │
               ▼                     ▼
        Cloudflare Pages          Android
```

---

## 2. Technology Stack & Key Libraries

- **Framework**: Angular 22 (Standalone Components, TypeScript strict mode, Angular Signals).
- **Styling**: Vanilla CSS Design Tokens (Dark mode default, light mode support, mobile safe-area insets, glassmorphism, zero Tailwind).
- **Mobile Bridge**: Capacitor 8 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/app`, `@capacitor/clipboard`, `@capacitor/status-bar`, `@capacitor/android`).
- **Cryptographic Primitives**:
  - **Key Derivation (KDF)**: `Argon2id` (RFC 9106) compiled via WebAssembly (`hash-wasm`).
  - **Symmetric Cipher**: `AES-256-GCM` (NIST SP 800-38D) via native browser `SubtleCrypto`.
  - **Randomness**: Browser `crypto.getRandomValues()` with unbiased rejection sampling.
- **Local Persistence**: `IndexedDB` (holds strictly authenticated encrypted envelopes; zero plaintext).
- **Remote Sync**: Google Drive REST API (`drive.appdata` isolated folder) via Google Identity Services (GIS) public client token flow.
- **Testing**: `Vitest` integrated via Angular CLI (`ng test --watch=false`).

---

## 3. Cryptographic Architecture & Specifications

### 3.1 Key Hierarchy: Direct Derivation (Option A)
$$\text{Master Password} \xrightarrow{\text{Argon2id}} \text{Vault Encryption Key (VEK)} \xrightarrow{\text{AES-256-GCM}} \text{Encrypted Vault}$$
- Single-key direct derivation eliminates wrapped-key failure modes.
- Changing the master password enforces full re-encryption under a new key, ensuring forward secrecy.

### 3.2 Argon2id Configuration (Offloaded to Web Worker)
- **Memory Cost ($m$)**: $65{,}536\text{ KiB}$ ($64\text{ MiB}$)
- **Time Cost / Iterations ($t$)**: $3$
- **Parallelism ($p$)**: $1$ (Optimized for Web Worker execution)
- **Salt**: 16 bytes (128 bits) CSPRNG randomness
- **Output Key Length**: 32 bytes (256 bits)
- **Execution**: Must run in a dedicated Web Worker (`crypto.worker.ts`) to prevent UI thread freezing.
- **Security Floor**: Rejects any imported or created vault with $m < 32\text{ MiB}$ or $t < 3$.

### 3.3 AES-256-GCM Authenticated Encryption
- **Key Length**: 256 bits (`AES-GCM`).
- **Initialization Vector (IV)**: 12 bytes (96 bits) CSPRNG randomness. **Never reused.**
- **Tag Length**: 128 bits.
- **Additional Authenticated Data (AAD)**: Canonical JSON serialization of public envelope header metadata (`formatVersion`, `kdf`, `encryption`) is fed as `additionalData`. Any tampering with KDF parameters, version, or IVs triggers an immediate AEAD tag verification failure.

### 3.4 Unbiased Password Generator
- Uses `crypto.getRandomValues()`.
- **Rejection sampling** is strictly required to eliminate modulo bias. Simple modulo arithmetic (`randomByte % charset.length`) is banned.
- Cryptographic Fisher-Yates array shuffling for rule enforcement.

### 3.5 Memory Hygiene Realities
- JavaScript memory wiping is **best-effort**, not guaranteed (V8 garbage collection controls strings).
- Sensitive typed arrays (`Uint8Array`) must be explicitly zeroed using `.fill(0)`.
- The Web Worker context is terminated (`worker.terminate()`) on vault lock.

### 3.6 Wire / Storage Envelope Format (`.zerovault` and IndexedDB)

```json
{
  "formatVersion": 1,
  "kdf": {
    "algorithm": "Argon2id",
    "params": {
      "memory": 65536,
      "iterations": 3,
      "parallelism": 1,
      "keyLength": 32
    },
    "salt": "<base64url_16_bytes>"
  },
  "encryption": {
    "cipher": "AES-256-GCM",
    "iv": "<base64url_12_bytes>",
    "tagLength": 128
  },
  "ciphertext": "<base64url_ciphertext_and_tag>"
}
```

### 3.7 Metadata Privacy
- **Public (Outside Ciphertext)**: `formatVersion`, `kdf` algorithm & params, `salt`, `encryption` params, `iv`, `ciphertext`.
- **Private (Strictly Inside Ciphertext)**: `vaultId`, `vaultName`, `revision`, `createdAt`, `updatedAt`, `categories`, and all `entries` (usernames, passwords, websites, notes, TOTP, custom fields).

---

## 4. Google Drive Synchronization Design

- **Scope**: Minimal privilege — strictly `https://www.googleapis.com/auth/drive.appdata`.
- **Public Client Model**: Uses Google Identity Services (GIS) Token Client. No client secrets in frontend.
- **Volatile Token Storage**: Access tokens are kept strictly in volatile memory. Never stored in `localStorage`, `IndexedDB`, or cookies.
- **Remote File**: `appDataFolder/vault.zerovault` (identical encrypted envelope, backward-compatible search with `vault.pradipvault`).
- **Rollback Mitigation**: Monotonically increasing `revision` number + SHA-256 envelope content hash.
- **3-Way Conflict Engine**: If local and remote both changed, halt automatic push and display a Conflict Resolution UI (Keep Local / Keep Remote / Merge Entries).

---

## 5. Current Project Status: Phase 1 Completed

### Completed Files & Infrastructure
1. **Scaffolding & Config**:
   - `angular.json` (standalone, Vitest test runner)
   - `tsconfig.json` & `tsconfig.app.json` (strict type checking enabled)
   - `capacitor.config.ts` (`appId: 'io.zerovault.app'`, `webDir: 'dist/zerovault/browser'`)
   - `android/` native platform initialized and synced with plugins
2. **Vanilla CSS Design System & Shell**:
   - `src/styles.css` (tokens for dark mode default, light mode toggle, safe-area insets, glassmorphism)
   - `src/index.html` (`viewport-fit=cover`, PWA manifest link, theme color)
   - `src/app/app.ts`, `app.html`, `app.css` (header, router viewport, mobile bottom nav, toast overlay)
3. **Reusable Components**:
   - `ButtonComponent` (`src/app/components/common/button/`)
   - `InputComponent` (`src/app/components/common/input/`) with password toggle
   - `ModalComponent` (`src/app/components/common/modal/`) with backdrop and escape hand    - `ToastContainerComponent` & `ToastService` (`src/app/components/common/toast/`)
    - `IconComponent` (`src/app/components/common/icon/`) zero-dep inline SVGs
 4. **Placeholder Pages**:
    - `WelcomeComponent` (`/`)
    - `CreateVaultComponent` (`/create-vault`)
    - `UnlockComponent` (`/unlock`)
    - `DashboardComponent` (`/dashboard`)
    - `SettingsComponent` (`/settings`)
    - `ThemeService` (persists theme choice, synchronizes `data-theme`)
 5. **Security & Deployment Artifacts**:
    - `public/_headers` (strict CSP, HSTS, X-Frame-Options)
    - `public/manifest.webmanifest`
    - `SECURITY.md`, `README.md`, `.gitignore`, `.env.example`

### What Phase 2 Completed:
 1. `crypto.types.ts`: typed interfaces, `KDF_SECURITY_FLOOR`, `DEFAULT_CRYPTO_CONFIG`, IPC contracts.
 2. `zeroizer.ts`: memory zeroing utilities (`wipeBuffer`, `wipeBuffers`).
 3. `serializer.ts`: binary-safe base64url encoder/decoder, canonical JSON AAD serializer (RFC 8785).
 4. `entropy.ts`: CSPRNG utilities with rejection sampling and Fisher-Yates shuffle.
 5. `argon2.ts`: Argon2id key derivation using `hash-wasm` WebAssembly.
 6. `aes.ts`: AES-256-GCM authenticated encryption/decryption with canonical AAD binding.
 7. `crypto.worker.ts`: dedicated Web Worker for off-thread key derivation and encryption.
 8. `crypto.service.ts`: Angular bridge service managing worker lifecycle and termination.
 9. `crypto.spec.ts`: 15 unit tests covering AEAD roundtrips, bit-flipping, IV tampering, AAD tampering, and 10,000-IV uniqueness.

### What Phase 3 Completed:
 1. `vault.model.ts`: `VaultEntry`, `CustomField`, `DecryptedVault` schema, `createEmptyVault()`.
 2. `storage.types.ts` & `storage.service.ts`: IndexedDB persistence (`zerovault_db`), storing strictly authenticated encrypted envelopes (`EncryptedVaultEnvelope`), rollback protection tracking `highestKnownRevision`.
 3. `vault.service.ts`: reactive Angular Signals (`isLocked`, `hasExistingVault`, `vault`, `isBusy`, `busyMessage`), lifecycle methods (`createVault`, `unlockVault`, `lockVault`, `saveCurrentVault`, `deleteVault`).
 4. UI lifecycle integration: real Argon2id derivation progress in `CreateVaultComponent` and `UnlockComponent`, "Lock Vault" button in app header, smart CTA routing in `WelcomeComponent`.
 5. Storage & Lifecycle tests: 10 unit tests across `storage.service.spec.ts` and `vault.service.spec.ts`. All 48 project tests passing.

### What Phase 4 Completed:
 1. `sanitizer.ts` & `sanitizer.spec.ts`: Safe URL validation and normalization (allowing only `http:` and `https:`, auto-prefixing missing scheme, neutralizing `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`), safe anchor attributes (`rel="noopener noreferrer"`, `target="_blank"`), control character stripping (14 unit tests).
 2. In-Memory Session Key Management: Added `ENCRYPT_VAULT_WITH_KEY` to Web Worker and `CryptoService`. Derived 256-bit AES key is held in volatile memory in `VaultService` upon unlock/creation, allowing subsequent entry additions, edits, and deletions to re-encrypt and persist in **< 1ms** with fresh CSPRNG IVs without re-running 64 MiB Argon2id or prompting for the master password. Volatile key buffers are explicitly zeroed via `wipeBuffer()` on `lockVault()`.
 3. `entry.service.ts` & `entry.service.spec.ts`: Reactive signals (`searchQuery`, `selectedCategory`, `sortBy`, `sortDirection`), computed signals (`filteredEntries`, `categoryCounts`), and persistent CRUD operations (`addEntry`, `updateEntry`, `deleteEntry`, `toggleFavorite`) (8 unit tests).
 4. `dashboard.component.ts` & `dashboard.component.spec.ts`: Full password manager dashboard connected to real services. Guarded locked state view, responsive toolbar with instant search, category navigation tabs with live counts, entries grid, modals for Add, View/Inspect (with password reveal toggle and secure clipboard copy), Edit, and Delete confirmation (6 unit tests).
 5. Production build (`npm run build`) passing with 0 warnings/errors. Total **77 automated unit tests across 13 test suites passing**. Capacitor Android platform synced.

### What Phase 5 Completed:
 1. `wordlist.ts`: Standardized 2,048 BIP-39 English wordlist providing exactly 11 bits of entropy per word ($2^{11} = 2048$).
 2. `generator.ts` & `generator.spec.ts`: CSPRNG unbiased random character password generation with rejection sampling (zero modulo bias), character set guarantees (uppercase, lowercase, digits, symbols), ambiguous character exclusion (`0`, `O`, `1`, `l`, `I`), and Diceware passphrase mode with custom separators and capitalization (14 unit tests).
 3. Password Entropy & Strength Evaluator: Calculates Shannon entropy ($E = L \times \log_2(N)$) and Diceware entropy (11 bits/word), classifying into Weak, Fair, Good, Strong, and Very Strong with color-coded progress meter.
 4. `password-generator.component.ts` & `password-generator.component.spec.ts`: Reusable interactive generator UI with dual mode switcher, live length/word-count sliders, charset checkboxes, copy to clipboard, and instant preview (5 unit tests).
 5. Dashboard Integration: Seamless "Generate" triggers embedded into Add Entry and Edit Entry credential modals with one-click password application.
 6. Auto-Lock & Defense-in-Depth Engine (`src/app/core/services/autolock.service.ts`):
    - Activity listener running outside NgZone with 1s throttling (`mousemove`, `keydown`, `touchstart`, `pointerdown`, `click`, `scroll`).
    - Configurable inactivity auto-lock timeout (1m, 5m, 15m, 30m, 60m, or never) persisted in `localStorage`.
    - Tab hidden / visibility change auto-lock protection toggle.
    - Native mobile app lifecycle listener via `@capacitor/app` (`appStateChange`) locking immediately when backgrounded.
    - Clipboard auto-clearing hygiene via `@capacitor/clipboard` / `navigator.clipboard` with customizable countdown (10s, 30s, 60s, 120s, or never) and manual "Clear Now" action.
    - Header countdown warning badge when remaining time is $\le 60\text{s}$.
 7. Encrypted Import / Export Engine (`.zerovault`):
    - Authenticated JSON backup format containing `magic: "ZERO_VAULT_BACKUP"`, `version: 1`, SHA-256 integrity hash, and `EncryptedVaultEnvelope`.
    - Backward-compatible import support for legacy `.pradipvault` (`magic: "PRADIP_VAULT_BACKUP"`).
    - Early integrity & tamper rejection before running Argon2id.
    - KDF security floor verification on import (`memory >= 32768 KiB`, `iterations >= 3`, `salt >= 16 bytes`).
    - Decryption verification with master password.
    - Conflict-free merge engine: resolves duplicate records by preferring newer `updatedAt` timestamps and appends new items.
    - Overwrite mode for complete vault restores.
    - Multi-step interactive Import Modal and Export Modal in Settings with automatic browser download trigger.
 8. Google Drive Sync & 3-Way Conflict Engine:
    - Zero-knowledge remote sync: Google Drive only receives encrypted AES-256-GCM envelopes in the isolated `appDataFolder` (`https://www.googleapis.com/auth/drive.appdata`).
    - GIS token client and OAuth2 flow support.
    - Encrypted Base Snapshot stored in IndexedDB (`sync_store`) to ensure zero-knowledge persistence at rest.
    - Deterministic 3-Way Merge algorithm handling concurrent additions, edits, deletions, and collisions.
    - Lossless collision resolution: newer `updatedAt` wins, with ambiguous collisions generating duplicate safety copies (`[Title] (Sync Conflict)`).
    - Monotonic revision enforcement and rollback attack protection.
    - Full Settings UI integration: connection indicator dot, Connect/Disconnect, Sync Now with spinning status, last synced timestamp, and OAuth Client ID configuration modal.
 9. PWA Service Worker & Cloudflare Deployment:
    - `_headers`: Strict CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Permissions-Policy, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, and path-specific caching (`no-cache` for `/sw.js`, `immutable` for hashed bundles).
    - `_redirects`: SPA rewrite rule (`/* /index.html 200`) preventing 404s on direct route navigation.
    - `manifest.webmanifest` & `public/icons/`: Complete standalone PWA configuration with 192x192, 512x512, 512x512 maskable, 180x180 apple touch, and SVG vector icons.
    - `sw.js`: Zero-dependency offline-first Service Worker caching core shell, network-first navigation with `/index.html` fallback, cache-first for hashed bundles, and API bypass.
    - `pwa.service.ts`: Reactive signals for `isOnline`, `swActive`, `updateAvailable`, and `canInstall` with install prompt and update lifecycle management.
    - Settings & Header UI: Offline status badges, update triggers, and install action.
 10. Security Audit & Documentation Finalization:
     - Comprehensive threat model matrix in `SECURITY.md` covering adversaries, assets, and cryptographic guarantees.
     - Hardened RFC 9106 Argon2id + NIST SP 800-38D AES-256-GCM + RFC 8785 Canonical JSON AAD specifications.
     - Production documentation in `README.md` covering architecture, development commands, Capacitor Android workflow, and Cloudflare Pages deployment.
     - Zero-knowledge compliance verified: 0 plaintext credentials stored or transmitted, memory zeroization on lock, strict CSP and COOP headers.
 11. Production build passing with 0 warnings/errors. Total **146 automated unit tests across 20 test suites passing**. Capacitor Android platform synced.

---

## 6. Development Phases Roadmap

- [x] **Phase 1: Project Scaffolding, Capacitor Android & Design System** *(COMPLETED)*
- [x] **Phase 2: Cryptographic Core & Isolated Web Worker** *(COMPLETED)*
- [x] **Phase 3: Encrypted Persistence (IndexedDB) & Vault Lifecycle** *(COMPLETED)*
- [x] **Phase 4: Password Manager CRUD & Dashboard** *(COMPLETED)*
- [x] **Phase 5: Unbiased Password Generator** *(COMPLETED)*
- [x] **Phase 6: Auto-Lock & Defense-in-Depth** *(COMPLETED)*
- [x] **Phase 7: Encrypted Import / Export (`.zerovault`)** *(COMPLETED)*
- [x] **Phase 8: Google Drive Sync & 3-Way Conflict Engine** *(COMPLETED)*
- [x] **Phase 9: PWA Service Worker & Cloudflare Deployment** *(COMPLETED)*
- [x] **Phase 10: Security Audit & Documentation Finalization** *(COMPLETED)*

---

## 7. Project Finalization & Verification Summary

ZeroVault is **100% complete and fully verified** across all 10 architectural phases:

1. **Cryptographic Core**: Web Worker Argon2id ($64\text{ MiB}$) + AES-256-GCM authenticated encryption + RFC 8785 canonical AAD binding.
2. **Persistence**: Encrypted envelope storage in IndexedDB (`zerovault_db`) with monotonic revision tracking and rollback attack defense.
3. **Password Manager CRUD**: Dynamic search, category filtering (Logins, Cards, Notes, Identities), favorites, masked field toggling, secure clipboard copying.
4. **CSPRNG Generator**: Unbiased password generator with rejection sampling, 2048-word BIP-39 Diceware passphrases, and Shannon entropy evaluator.
5. **Defense-in-Depth**: Inactivity auto-lock (outside NgZone), tab-hidden lock, mobile background lock via Capacitor App, and clipboard auto-clearing.
6. **Encrypted Backups**: `.zerovault` export/import format with SHA-256 pre-KDF integrity checksum, backward-compatible `.pradipvault` restore, and conflict-free merge vs overwrite strategies.
7. **Google Drive Sync**: Sandboxed `appDataFolder`, zero token persistence, encrypted base snapshot, deterministic 3-way merge, and lossless collision copies.
8. **PWA & Cloudflare Pages**: Zero-dependency offline Service Worker, standalone web manifest, strict CSP, HSTS, and SPA rewrite rules (`/* /index.html 200`).
9. **Automated Verification**: **146 unit tests passing across 20 test suites**, production bundle built cleanly, and Capacitor Android synced.



