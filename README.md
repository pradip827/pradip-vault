# ZeroVault 🔐

<p align="center">
  <img src="public/icons/logo-transparent.svg" alt="ZeroVault Logo" width="480" />
</p>

> A zero-knowledge, client-side encrypted personal password manager built with **Angular 22 & TypeScript**, targeting **Web/PWA** (Cloudflare Pages) and **Native Android** via **Capacitor 8**.

```
                           ZEROVAULT ARCHITECTURE
                                       │
                      Angular 22 + TypeScript Standalone
                                       │
                      ┌────────────────┴────────────────┐
                      │                                 │
                 Web / PWA                          Capacitor 8
             (Service Worker)                    (Native Android)
                      │                                 │
                      ▼                                 ▼
               Cloudflare Pages                     Google Play
           (_headers + _redirects)                   (APK / AAB)
```

---

## 🌟 Key Features

- **Zero-Knowledge Architecture**: No proprietary backend. All encryption and key derivation occur 100% client-side.
- **Argon2id Key Derivation**: High-security, memory-hard hashing ($64\text{ MiB}$ RAM, $t=3$ iterations) running in an isolated Web Worker via WebAssembly (`hash-wasm`).
- **AES-256-GCM Authenticated Encryption**: 256-bit symmetric encryption with unique 96-bit CSPRNG IVs per operation and RFC 8785 Canonical JSON Additional Authenticated Data (AAD) binding.
- **Instant In-Memory Re-Encryption**: Derived session key permits subsequent credential additions and edits to re-encrypt in **$< 1\text{ ms}$** without re-prompting for the master password.
- **Encrypted Local Persistence**: Strictly encrypted envelopes persisted in **IndexedDB** (`zerovault_db`) with monotonic revision tracking and rollback attack protection.
- **Credential Management & Dashboard**: Full CRUD for Logins, Credit Cards, Secure Notes, and Identities with instant search, category filters, favorites, and masked credential toggles.
- **Unbiased Password & Passphrase Generator**: CSPRNG character generator with rejection sampling (zero modulo bias) and 2,048-word BIP-39 Diceware passphrases with Shannon entropy classification.
- **Defense-in-Depth Auto-Lock**: Configurable inactivity timeout (1m to 60m), immediate tab-hidden lock on visibility change, and Android backgrounding lock via `@capacitor/app`.
- **Clipboard Hygiene**: Automated clipboard auto-clearing timer (default: 30s) and manual "Clear Now" action.
- **Encrypted Backup & Restore (`.zerovault`)**: Authenticated backup format with pre-KDF SHA-256 checksum verification, KDF security floor check, and conflict-free merge vs overwrite restore modes.
- **Google Drive Sync & 3-Way Conflict Engine**: Zero-knowledge sync via Google Drive's isolated `appDataFolder` (`drive.appdata` scope), encrypted base snapshot persistence, deterministic 3-way merge, and lossless collision copies.
- **Chrome Browser Extension & Autofill**: Native Manifest V3 extension featuring 1-click in-field autofill, moveable floating assistant pill, intelligent login autosave with duplicate detection, and live Web Vault sync bridge.
- **Progressive Web App (PWA) & Offline First**: Zero-dependency Service Worker precaching core assets, network-first navigation with `/index.html` fallback, and native install prompt support.
- **Cloudflare Pages & Serverless Configuration**: Preconfigured `_headers` (strict CSP, HSTS, COOP, Permissions-Policy), `_redirects` SPA rewrite rules, and `/api/config` serverless function for automated `GOOGLE_CLIENT_ID` injection.

---

## 📁 Project Structure

```
zerovault/
├── android/                         # Capacitor Native Android project
├── extension/                       # Chrome Browser Extension (Manifest V3)
│   ├── manifest.json                # Extension manifest
│   ├── background/                  # Service worker (domain matching, vault state)
│   ├── content/                     # In-page autofill, floating pill & autosave
│   ├── popup/                       # Toolbar popup UI (search, generator, session status)
│   └── icons/                       # Raster & vector extension icons
├── functions/                       # Cloudflare Pages Functions
│   └── api/
│       └── config.js                # Serverless GOOGLE_CLIENT_ID runtime endpoint
├── public/
│   ├── _headers                     # Cloudflare Pages security & caching headers
│   ├── _redirects                   # Cloudflare Pages SPA rewrite rule
│   ├── favicon.ico
│   ├── manifest.webmanifest         # PWA Web App Manifest
│   ├── sw.js                        # Offline-first Service Worker
│   └── icons/                       # High-DPI raster & vector PWA icons
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   └── common/              # Reusable standalone components
│   │   │       ├── badge/           # BadgeComponent
│   │   │       ├── button/          # ButtonComponent
│   │   │       ├── icon/            # IconComponent (zero-dep inline SVG icons)
│   │   │       ├── input/           # InputComponent (password toggle & error states)
│   │   │       ├── modal/           # ModalComponent
│   │   │       ├── password-generator/ # Reusable PasswordGeneratorComponent
│   │   │       └── toast/           # ToastContainerComponent
│   │   ├── core/
│   │   │   ├── crypto/              # Cryptographic core & Web Worker
│   │   │   │   ├── aes.ts           # AES-256-GCM encryption & decryption
│   │   │   │   ├── argon2.ts        # Argon2id WebAssembly derivation
│   │   │   │   ├── entropy.ts       # CSPRNG IV & salt generators
│   │   │   │   ├── generator.ts     # Unbiased password & Diceware generator
│   │   │   │   ├── serializer.ts    # RFC 8785 Canonical JSON & base64url
│   │   │   │   ├── wordlist.ts      # 2,048-word BIP-39 English dictionary
│   │   │   │   └── crypto.worker.ts # Dedicated isolated Web Worker
│   │   │   ├── models/              # TypeScript domain interfaces
│   │   │   ├── security/            # Sanitizer & memory zeroizer utilities
│   │   │   ├── services/            # Singleton Angular services
│   │   │   │   ├── autolock.service.ts   # Inactivity, tab-hidden & clipboard
│   │   │   │   ├── backup.service.ts     # .zerovault import/export engine
│   │   │   │   ├── crypto.service.ts     # Web Worker communication bridge
│   │   │   │   ├── entry.service.ts      # Credential CRUD, search & filtering
│   │   │   │   ├── google-drive.service.ts # Google Drive API & OAuth2
│   │   │   │   ├── pwa.service.ts        # Service Worker & connectivity signals
│   │   │   │   ├── storage.service.ts    # IndexedDB persistence layer
│   │   │   │   ├── sync.service.ts       # 3-Way merge & conflict engine
│   │   │   │   ├── theme.service.ts      # Dark & light theme management
│   │   │   │   ├── toast.service.ts      # Reactive notification toasts
│   │   │   │   └── vault.service.ts      # Vault lifecycle & volatile key state
│   │   │   └── storage/             # IndexedDB schema types & constants
│   │   ├── pages/                   # Routed view components
│   │   │   ├── create-vault/        # CreateVaultComponent
│   │   │   ├── dashboard/           # DashboardComponent
│   │   │   ├── settings/            # SettingsComponent
│   │   │   ├── unlock/              # UnlockComponent
│   │   │   └── welcome/             # WelcomeComponent
│   │   ├── app.routes.ts            # Angular standalone application routing
│   │   ├── app.ts                   # Root shell component
│   │   ├── app.html                 # App shell layout (header + mobile bottom nav)
│   │   └── app.css                  # App shell specific styles
│   ├── index.html                   # HTML entrypoint with safe-area viewport & PWA meta
│   ├── main.ts                      # Angular bootstrap entrypoint
│   └── styles.css                   # Core Vanilla CSS design system & tokens
├── angular.json                     # Angular CLI workspace configuration
├── capacitor.config.ts              # Capacitor multi-platform configuration
├── package.json                     # Pinned dependencies & npm scripts
├── tsconfig.json                    # Strict TypeScript configuration
├── README.md                        # Documentation & guides
└── SECURITY.md                      # Security policy & cryptographic threat model
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: `v20+` or `v22+`
- **npm**: `v10+`
- **Android Studio** (optional, for building the native Android APK)

### Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/example/zerovault.git
cd zerovault
npm install --legacy-peer-deps
```

---

## 💻 Development Commands

### Run the Web Application Locally
Starts the Angular development server on port 4300:
```bash
npm start
```
Navigate to `http://localhost:4300` in your browser.

### Run Automated Unit Tests
Executes the comprehensive Vitest unit test suite (178 tests across 21 suites):
```bash
npm test
```

### Production Build
Compiles the production bundle to `dist/zerovault/browser` with zero warnings:
```bash
npm run build
```

---

## 📱 Capacitor & Android Workflow

ZeroVault is configured with Capacitor 8 for native Android execution:

### 1. Build Web Assets & Synchronize
Compiles the Angular application and copies distribution assets into the Android native directory:
```bash
npm run cap:sync
```

### 2. Open Native Android Project
Launches the Android project in Android Studio for debugging, emulation, or generating signed APKs/AABs:
```bash
npm run cap:android
```

### 3. Build APK via Command Line
```bash
cd android && ./gradlew assembleDebug
```
The output APK will be located at `android/app/build/outputs/apk/debug/app-debug.apk`.

---

## 🧩 Chrome Browser Extension

ZeroVault includes a built-in Manifest V3 browser extension for 1-click in-page autofill, autosave, and seamless synchronization with your authoritative Web Vault:

### Security Architecture & Features
- **Authenticated Companion Model**: The Web Vault (`https://pradip-vault.pages.dev`) remains the single cryptographic root. The extension operates as an authenticated companion holding ephemeral credentials in volatile memory only.
- **Least-Privilege Autofill**: Injected content scripts receive **only metadata** (`{ id, title, username }`) with **zero passwords**. A single password is provided to the tab only upon explicit user click.
- **Strict Normalized Origin Matching**: Protects against cousin-domain and substring spoofing (e.g. `evilgithub.com` or `github.com.evil.com` cannot trigger or receive `github.com` credentials).
- **Explicit-Confirmation Autosave**: Detects login submissions and prompts the user with an in-page confirmation toast. Passwords are never saved silently.
- **Zero Plaintext Persistence**: Decrypted vaults are never stored in `chrome.storage` or IndexedDB. A restarted MV3 background service worker starts in a locked state by default.
- **Zero Master Password Handling**: Master passwords are never input or stored in the extension. Key derivation remains exclusive to the authoritative Web Vault via Argon2id ($64\text{ MiB}, t=3, p=1$).

### Installation (Developer Mode)
1. In Google Chrome, open `chrome://extensions`.
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click **Load unpacked**.
4. Select the `extension/` folder from this repository:
   ```
   pradip-vault/extension
   ```
5. Open and unlock your Web Vault at `https://pradip-vault.pages.dev` to establish the authenticated session.

---

## ☁️ Cloudflare Pages Deployment

ZeroVault is 100% static and requires zero application servers.

1. **Framework Preset**: `None`
2. **Build Command**: `npm run build`
3. **Build Output Directory**: `dist/zerovault/browser`
4. **Environment Variables (Optional)**:
   - `GOOGLE_CLIENT_ID`: Your Google OAuth 2.0 Web Client ID. When configured, Cloudflare Pages serverless function (`functions/api/config.js`) injects it automatically so you never have to re-enter it manually.
5. **Security & Routing**:
   - `public/_headers` deploys strict CSP, HSTS, X-Frame-Options, and immutable asset caching.
   - `public/_redirects` guarantees client-side SPA routing for all paths (`/* /index.html 200`).

---

## 🛡️ Security & Cryptographic Guarantee

ZeroVault enforces the following cryptographic parameters:
- **Key Derivation**: Argon2id via WebAssembly ($64\text{ MiB}$ memory, $t=3$ iterations, $p=1$).
- **Symmetric Cipher**: AES-256-GCM with 96-bit CSPRNG IV generated per operation and 128-bit authentication tag.
- **Header Integrity**: RFC 8785 Canonical JSON Additional Authenticated Data (AAD) bound into the AEAD tag.
- **Zero Plaintext Storage**: Plaintext credentials are never written to disk or transmitted over the network.

For the exhaustive threat model, adversary analysis, memory hygiene details, and vulnerability disclosure policy, consult [SECURITY.md](SECURITY.md).

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
