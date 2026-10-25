# Argus — Secure Proctored Exam Desktop App

> **macOS-only** | Electron 44 + React 19 + Vite | No backend, no database

Argus is a fully self-contained desktop exam application built as a course project
for *Application Development — Desktop*, ADYPU. It demonstrates all core Electron
concepts: main/renderer process isolation, contextBridge, IPC, file I/O, kiosk
lockdown, and local persistence — with zero external backend.

---

## Table of Contents

1. [Features](#features)
2. [Architecture at a Glance](#architecture-at-a-glance)
3. [Getting Started](#getting-started)
4. [Project Structure](#project-structure)
5. [IPC Contract](#ipc-contract)
6. [Building a Distribution DMG](#building-a-distribution-dmg)
7. [Not Implemented](#not-implemented)
8. [Viva Cheat-Sheet](#viva-cheat-sheet)

---

## Features

| Area | What Argus does |
|---|---|
| **Exam flow** | Setup → Rules dialog → Exam → Submit → Result |
| **Question bank** | Loads `electron/data/questions.json`; can import a custom bank via file-picker |
| **Lockdown** | Kiosk mode, stripped application menu, quit guard, single-instance |
| **Timer** | Drift-free wall-clock timer; ticks continue if the app is closed |
| **Proctoring** | Multi-monitor detection, banned-process scanning, periodic webcam snapshots |
| **Violations** | Real-time banner, native OS notifications, dock badge, auto-terminate at limit |
| **Scoring** | Graded in the main process (renderer never sees `answerIndex`) |
| **Result screen** | Score summary, per-question review, violation log, export to PDF / JSON |
| **Persistence** | Atomic JSON writes, crash recovery, autosave every 10 s |
| **Error handling** | React ErrorBoundary in renderer; uncaughtException handler in main |

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (React 19 + Vite, runs in Chromium sandbox)   │
│  src/screens/   src/components/   src/hooks/            │
│  Communicates ONLY via window.argus (contextBridge API) │
└────────────────────┬────────────────────────────────────┘
                     │ ipcRenderer.invoke / ipcMain.handle
┌────────────────────▼────────────────────────────────────┐
│  Preload  (electron/preload.cjs — contextIsolation: on) │
│  Exposes window.argus.*  — no Node.js APIs leak through │
└────────────────────┬────────────────────────────────────┘
                     │ require()
┌────────────────────▼────────────────────────────────────┐
│  Main process  (electron/main.cjs + services/)          │
│  examStore  | storage  | lockdown  | proctor | scoring  │
└─────────────────────────────────────────────────────────┘
```

**Key design rules (enforced throughout)**
- Channels are defined once in `electron/ipc/channels.cjs` and mirrored verbatim in `electron/preload.cjs`.
- All IPC handlers live in `electron/ipc/register.cjs`.
- The renderer calls `src/api.js` — never `window.argus` directly.
- No `nodeIntegration: true`, no `contextIsolation: false`.

---

## Getting Started

### Prerequisites

- macOS 12+ (Monterey or later)
- Node.js 20+ (LTS recommended)
- npm 10+

### Install

```bash
# clone the repo
git clone https://github.com/<your-handle>/argus-exam.git
cd argus-exam
npm install
```

### Development mode

Starts the Vite dev server and Electron side-by-side with hot-reload:

```bash
npm run dev
```

### Production preview

Builds the renderer bundle then launches Electron against it:

```bash
npm start
```

### Lint

```bash
npm run lint
```

---

## Project Structure

```
argus/
├── build/
│   └── adhoc-sign.cjs       # Ad-hoc macOS code-signing helper
├── docs/
│   └── ARCHITECTURE.md      # Detailed design decisions
├── electron/
│   ├── main.cjs             # App entry point, lifecycle, quit guard
│   ├── preload.cjs          # contextBridge API surface
│   ├── menu.cjs             # Dynamic application menu
│   ├── window.cjs           # BrowserWindow factory
│   ├── core/
│   │   ├── examStore.cjs    # Finite-state exam state machine
│   │   ├── lifecycle.cjs    # Dispose pattern (appScope)
│   │   ├── autosave.cjs     # Debounced + periodic autosave
│   │   └── trust.cjs        # URL allowlist
│   ├── data/
│   │   └── questions.json   # Default 15-question MCQ bank
│   ├── ipc/
│   │   ├── channels.cjs     # Channel name constants
│   │   └── register.cjs     # ipcMain.handle registrations
│   └── services/
│       ├── lockdown.cjs     # Rules dialog, kiosk, monitor guard
│       ├── permissions.cjs  # Chromium permission handlers
│       ├── questionBank.cjs # Bank loading, validation, import
│       ├── storage.cjs      # Atomic JSON persistence
│       ├── notifier.cjs     # Native OS notifications
│       ├── proctor.cjs      # Multi-monitor + process scanning
│       ├── scoring.cjs      # Answer grading (main process only)
│       └── exporter.cjs     # PDF / JSON result export
├── src/
│   ├── main.jsx             # React entry point (with ErrorBoundary)
│   ├── App.jsx              # Screen router + store subscription
│   ├── api.js               # Thin renderer wrappers over window.argus
│   ├── components/
│   │   ├── ErrorBoundary.jsx
│   │   ├── TitleBar.jsx
│   │   └── WarningBanner.jsx
│   ├── hooks/
│   │   └── useSnapshots.js  # Periodic webcam snapshot sender
│   ├── screens/
│   │   ├── SetupScreen.jsx
│   │   ├── ExamScreen.jsx
│   │   └── ResultScreen.jsx
│   ├── styles/
│   │   └── app.css
│   └── utils/
└── electron/data/questions.json
```

---

## IPC Contract

All channels are in `electron/ipc/channels.cjs`. The renderer accesses them via `src/api.js`:

| Channel | Direction | Purpose |
|---|---|---|
| `exam:get-state` | R→M | Fetch current exam state snapshot |
| `exam:start` | R→M | Begin exam (shows rules dialog, enters kiosk) |
| `exam:answer` | R→M | Record an answer |
| `exam:submit` | R→M | Manual submit |
| `exam:get-review` | R→M | Get scored answers for result screen |
| `exam:state-changed` | M→R | Push state updates |
| `questions:load` | R→M | Load/validate a question bank |
| `questions:import` | R→M | Open file picker and import custom bank |
| `questions:changed` | M→R | Notify renderer of bank change |
| `proctor:save-snapshot` | R→M | Send a webcam JPEG buffer for storage |
| `proctor:violation` | M→R | Push violation event to renderer |
| `report:export-pdf` | R→M | Open save dialog and write PDF |
| `report:export-json` | R→M | Open save dialog and write JSON |
| `report:open-snapshots` | R→M | Open snapshots folder in Finder |

---

## Building a Distribution DMG

```bash
# 1. Build the renderer + package the Electron app
npm run dist

# 2. Ad-hoc sign all Mach-O binaries (no paid certificate needed)
node build/adhoc-sign.cjs
```

The `.dmg` is written to `dist/`.

> **Note:** Ad-hoc signing lets the app run on *your own Mac* but Gatekeeper will
> block it on other machines unless you notarise with a paid Apple Developer account.
> For the course demo, ad-hoc is sufficient.

---

## Not Implemented

The following items were scoped out to keep the codebase small and explainable:

- **Notarisation / stapling**: Requires a paid Apple Developer account.
- **Auto-updater**: Out of scope for a course project.
- **Windows / Linux packaging**: Only macOS targets are configured.
- **Server-side answer upload**: No backend — results stay on disk.

---

## Viva Cheat-Sheet

| Question | Answer |
|---|---|
| Why `.cjs` extension in electron/ ? | Electron loads CommonJS (require) while the Vite renderer uses ESM. Mixing is controlled via `"type":"module"` in package.json. |
| What is contextIsolation? | Separates the preload's JS context from the renderer's page context. Prevents untrusted page code from accessing Node APIs via the preload scope. |
| What does contextBridge.exposeInMainWorld do? | Creates `window.argus` in the renderer's isolated world. Only what is explicitly listed in the bridge is accessible. |
| Why ipcMain.handle + ipcRenderer.invoke? | Request/reply pattern with a returned Promise. Avoids raw `send`/`on` which have no built-in error propagation. |
| What is a single-instance lock? | `app.requestSingleInstanceLock()` ensures only one process owns the lock. A second launch immediately quits and focuses the existing window. |
| What is `app.getPath('userData')`? | Returns `~/Library/Application Support/argus-exam` on macOS — the right place to store session JSON files. |
| Why atomic writes? | Write to a `.tmp` file first, then `fs.rename` over the real file. `rename` is atomic — a crash mid-write cannot corrupt the previous good data. |