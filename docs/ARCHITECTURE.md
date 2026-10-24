# Argus — Architecture Documentation

Argus is a secure, proctored exam desktop application designed for macOS, built as an Application Development course project.

---

## 1. Process Model

Argus follows Electron's multi-process architecture with strict isolation boundaries:

- **Main Process (`electron/main.cjs`, `electron/window.cjs`, `electron/ipc/`)**:
  - Runs in a full Node.js runtime environment with direct access to macOS system APIs, window lifecycle management, and hardware resources.
  - Responsible for creating browser windows, enforcing application security policies, and managing system-level monitoring.
- **Renderer Process (`src/`)**:
  - Runs inside a sandboxed Chromium browser window executing React 19 and standard Web APIs.
  - Strictly forbidden from accessing Node.js or Electron primitives directly (`nodeIntegration: false`, `sandbox: true`).
- **Preload Script (`electron/preload.cjs`)**:
  - Serves as the secure bridge between the privileged Main Process and the unprivileged Renderer Process.
  - Exposes controlled, validated APIs to the renderer via `contextBridge.exposeInMainWorld('argus', ...)`.

> **Note on `.cjs` Extension**: The root `package.json` contains `"type": "module"` to allow Vite and React components in `src/` to use ES modules (`import`/`export`). Because Electron main and preload scripts use Node.js CommonJS (`require`/`module.exports`), they are explicitly given the `.cjs` file extension.

---

## 2. Directory Structure

```
argus/
├── docs/
│   └── ARCHITECTURE.md        # Living architecture document & design decisions
├── electron/
│   ├── ipc/
│   │   ├── channels.cjs       # Single source of truth for IPC channel strings
│   │   └── register.cjs       # IPC handler registration & sender validation
│   ├── main.cjs               # App lifecycle & entry point
│   ├── window.cjs             # BrowserWindow configuration, security guards & push messaging
│   └── preload.cjs            # Context bridge with explicit channel allowlist
├── src/
│   ├── api.js                 # Renderer-side typed client wrapping window.argus
│   ├── components/
│   │   └── TitleBar.jsx       # Custom frameless title bar & window controls
│   ├── App.jsx                # Main React UI component
│   ├── main.jsx               # React DOM mounting & entry point
│   └── styles/
│       └── app.css            # CSS design tokens, typography, and theme
├── public/                    # Static public assets
├── index.html                 # Application HTML shell
├── vite.config.js             # Vite bundler, dev server & production CSP plugin
├── eslint.config.js           # ESLint flat configuration (ESM + CommonJS)
├── package.json               # Project manifest, dependencies, and scripts
└── README.md                  # Project quickstart guide
```

---

## 3. Core Architectural Rules

Every commit in this project adheres to the following principles:

1. **CommonJS for Electron**: All Electron files reside in `electron/` and use the `.cjs` extension with CommonJS `require()`.
2. **Strict Renderer Boundary**: The renderer process (`src/`) must never import `electron`, Node built-in modules (`fs`, `path`, `child_process`), or any native modules.
3. **Controlled OS Access**: All OS access, native calls, and Electron IPC communications must flow through `window.argus` and be consumed via `src/api.js`.
4. **IPC Channel Naming Standard**: IPC channel names follow the structured `"domain:action"` format (e.g., `"app:get-info"`, `"window:minimize"`).
5. **Main Process State Retention**: Any state or session data that must survive renderer navigation or window reloads must reside in the Main Process.

---

## 4. IPC Contract & Security Architecture

### 4.1 Response Envelope Format
All IPC handlers invoked from the renderer return a uniform response envelope:
- **Success**: `{ ok: true, data: T }`
- **Failure**: `{ ok: false, error: { code: string, message: string } }`

The renderer's `src/api.js` unwrap utility unpacks this envelope, returning `data` on success or throwing an `Error` with `err.code` and `err.message` on failure.

### 4.2 Sender Trust Validation (`isTrustedSender`)
Every IPC invocation in `electron/ipc/register.cjs` is verified before execution:
1. `event.senderFrame` must exist and be valid.
2. `event.sender` must strictly match the main application window's `webContents`.
3. The frame URL (`event.senderFrame.url`) must match the authorized origin:
   - In development: starts with `process.env.ARGUS_DEV_URL` (`http://localhost:5173`)
   - In production: starts with `file://` (pointing to the local `dist/` directory)

Calls failing this validation are rejected immediately with error code `'FORBIDDEN'`.

### 4.3 IPC Contract Specification

| Channel | Direction | Payload | Return Value | Description |
|---|---|---|---|---|
| `app:get-info` | Renderer → Main (`invoke`) | `void` | `{ name, version, platform, isPackaged, electronVersion }` | Returns application and runtime environment metadata |
| `window:minimize` | Renderer → Main (`invoke`) | `void` | `null` | Minimizes the main application window |
| `window:toggle-maximize` | Renderer → Main (`invoke`) | `void` | `null` | Toggles between maximized and restored window states |
| `window:close` | Renderer → Main (`invoke`) | `void` | `null` | Closes the main window and exits the exam application |
| `window:state` | Main → Renderer (`push`) | `{ isMaximized: boolean, isFullScreen: boolean }` | `void` | Notifies the renderer of window state changes |

---

## 5. Security Guards & Content Security Policy (CSP)

1. **Navigation Guards (`electron/window.cjs`)**:
   - `will-navigate`: Intercepts and blocks any navigation attempting to leave the application origin (`ARGUS_DEV_URL` in dev, `file://` in prod).
   - `setWindowOpenHandler`: Denies all child window/tab creation requests (`window.open`, `target="_blank"`).
   - `will-attach-webview`: Blocks attempts to mount embedded `<webview>` tags.
2. **Content Security Policy (CSP)**:
   - **Production**: A strict CSP meta tag is injected by the Vite plugin `argusCsp()` during build:
     ```text
     default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none';
     ```
   - **Development Trade-Off**: In development mode, Vite's Hot Module Replacement (HMR) requires dynamic inline scripts and a local WebSocket server (`ws://localhost:5173`). Applying the strict production CSP in development would break hot reloading. As an intentional architectural trade-off, the CSP is applied only to production builds (`apply: 'build'`), and Electron's development console warning regarding missing CSP is expected.

---

## 6. Commit Log

- **Commit 1: chore: scaffold Electron + React + Vite desktop app**
  - Cloned repository and verified Node 20+ runtime.
  - Scaffolded Vite + React 19 template without third-party UI frameworks.
  - Configured Electron main process lifecycle (`electron/main.cjs`), hardened BrowserWindow setup (`electron/window.cjs`), and preload stub (`electron/preload.cjs`).
  - Added CSS design tokens with light/dark theme support and system-ui typography.
  - Configured ESLint with CommonJS support for Electron scripts.

- **Commit 2: feat(security): secure preload bridge, IPC contract and custom title bar**
  - Defined single-source frozen IPC channel contract (`electron/ipc/channels.cjs`).
  - Implemented secure handler registration with sender frame validation and `{ ok, data }` envelopes (`electron/ipc/register.cjs`).
  - Created hardened preload bridge with channel filtering and payload-only event isolation (`electron/preload.cjs`).
  - Added typed renderer client wrapper (`src/api.js`) with automatic error unwrapping and browser fallbacks.
  - Built custom frameless title bar with drag/no-drag regions, dynamic app version, and window controls (`src/components/TitleBar.jsx`).
  - Added navigation and webview guards to `electron/window.cjs`.
  - Added production CSP injection plugin in `vite.config.js`.
