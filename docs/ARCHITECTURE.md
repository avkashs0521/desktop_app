# Argus — Architecture Documentation

Argus is a secure, proctored exam desktop application designed for macOS, built as an Application Development course project.

---

## 1. Process Model

Argus follows Electron's multi-process architecture with strict isolation boundaries:

- **Main Process (`electron/main.cjs`, `electron/window.cjs`)**:
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
│   └── ARCHITECTURE.md    # Living architecture document & design decisions
├── electron/
│   ├── main.cjs           # App lifecycle & entry point
│   ├── window.cjs         # BrowserWindow configuration & page loading
│   └── preload.cjs        # Context bridge (bridge stubbed; added in commit 2)
├── src/
│   ├── App.jsx            # Main React UI component
│   ├── main.jsx           # React DOM mounting & entry point
│   └── styles/
│       └── app.css        # CSS design tokens, typography, and base theme
├── public/                # Static public assets
├── index.html             # Application HTML shell
├── vite.config.js         # Vite bundler & dev server config
├── eslint.config.js       # ESLint flat configuration (ESM + CommonJS)
├── package.json           # Project manifest, dependencies, and scripts
└── README.md              # Project quickstart guide
```

---

## 3. Core Architectural Rules

Every commit in this project adheres to the following principles:

1. **CommonJS for Electron**: All Electron files reside in `electron/` and use the `.cjs` extension with CommonJS `require()`.
2. **Strict Renderer Boundary**: The renderer process (`src/`) must never import `electron`, Node built-in modules (`fs`, `path`, `child_process`), or any native modules.
3. **Controlled OS Access**: All OS access, native calls, and Electron IPC communications must flow through `window.argus`.
4. **IPC Channel Naming Standard**: IPC channel names follow the structured `"domain:action"` format (e.g., `"system:get-status"`).
5. **Main Process State Retention**: Any state or session data that must survive renderer navigation or window reloads must reside in the Main Process.

---

## 4. Commit Log

- **Commit 1: chore: scaffold Electron + React + Vite desktop app**
  - Cloned repository and verified Node 20+ runtime.
  - Scaffolded Vite + React 19 template without third-party UI frameworks.
  - Configured Electron main process lifecycle (`electron/main.cjs`), hardened BrowserWindow setup (`electron/window.cjs`), and preload stub (`electron/preload.cjs`).
  - Added CSS design tokens with light/dark theme support and system-ui typography.
  - Configured ESLint with CommonJS support for Electron scripts.
