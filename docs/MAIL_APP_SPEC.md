# ZenMail — Mac Gmail Client · Project Spec

> One-pager for Claude Code. Last updated: 2026-07-02

---

## 1. Product summary

A minimal, keyboard-first Gmail client for macOS.  
Target feel: Linear's density + Superhuman's command palette, without AI features or subscription bloat.  
Built for a single user who wants to escape the browser tab without paying $30/month.

---

## 2. Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Electron 33 + Node 22 | Mac `.app` bundle, web tech, large ecosystem |
| Frontend | React 19 + TypeScript | Component model, fast iteration |
| Styling | Tailwind CSS v4 | Utility-first, Linear-style tight density |
| Email API | Google Gmail REST API v1 | Full label/thread/filter support (not IMAP) |
| Auth | Google OAuth 2.0 (PKCE) | Tokens stored in macOS Keychain via `keytar` |
| Build | Electron Forge + Vite | Fast HMR in dev, DMG/ZIP output for prod |
| Command palette | `kbar` | Accessible, composable, Superhuman-style ⌘K |
| State | Zustand | Lightweight, no boilerplate |
| Local cache | SQLite via `better-sqlite3` | Offline thread cache, instant search |

---

## 3. Gmail API scopes

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.labels
```

OAuth client type: **Desktop app** (Google Cloud Console).  
Redirect URI: `http://localhost` (Electron catches the redirect).  
Token storage: `keytar.setPassword('zenmail', email, JSON.stringify(tokens))`.

---

## 4. Core features (MVP)

### 4-1. Split inbox

- Two sections in the thread list: **Primary** and **Other**
- Primary = threads with label `INBOX` that are NOT in Social / Promotions / Updates / Forums
- Other = everything else in INBOX
- Implemented via Gmail API `label` filter on `threads.list`
- Toggle between Split / Unified via ⌘⇧I

### 4-2. Label sidebar

- Renders all user labels from `labels.list`
- Shows unread count badge
- Color dot matches Gmail label color (`labelListVisibility: labelShow`)
- Click → filters thread list to that label
- Keyboard: `g` then `l` to jump to label picker

### 4-3. Command palette (⌘K)

Trigger: `⌘K` anywhere in the app.  
Built with `kbar`. Actions registered on mount:

```ts
[
  { id: 'compose',    name: 'Compose',          shortcut: ['c'],        perform: () => openCompose() },
  { id: 'archive',    name: 'Archive',           shortcut: ['e'],        perform: () => archiveCurrent() },
  { id: 'reply',      name: 'Reply',             shortcut: ['r'],        perform: () => openReply() },
  { id: 'replyAll',   name: 'Reply all',         shortcut: ['a'],        perform: () => openReplyAll() },
  { id: 'forward',    name: 'Forward',           shortcut: ['f'],        perform: () => openForward() },
  { id: 'label',      name: 'Apply label…',      shortcut: ['l'],        perform: () => openLabelPicker() },
  { id: 'snooze',     name: 'Snooze…',           shortcut: ['b'],        perform: () => openSnoozePicker() },
  { id: 'trash',      name: 'Move to trash',     shortcut: ['#'],        perform: () => trashCurrent() },
  { id: 'markRead',   name: 'Mark as read',      shortcut: ['Shift','I'],perform: () => markRead() },
  { id: 'markUnread', name: 'Mark as unread',    shortcut: ['Shift','U'],perform: () => markUnread() },
  { id: 'search',     name: 'Search mail',       shortcut: ['/'],        perform: () => focusSearch() },
  { id: 'inbox',      name: 'Go to inbox',       shortcut: ['g','i'],    perform: () => navigate('/inbox') },
  { id: 'sent',       name: 'Go to sent',        shortcut: ['g','s'],    perform: () => navigate('/sent') },
  { id: 'drafts',     name: 'Go to drafts',      shortcut: ['g','d'],    perform: () => navigate('/drafts') },
]
```

### 4-4. Thread list

- Virtualized list (`react-virtual`) — handles 10k+ threads
- Each row: sender name, subject, snippet, timestamp, unread dot, label chips
- `j` / `k` to move up/down
- `Enter` to open thread
- Swipe gestures (trackpad): right → archive, left → snooze

### 4-5. Thread view

- Renders email HTML in a sandboxed `<webview>` (no JS execution, no external image load by default)
- Collapses quoted replies (toggle with `...` button)
- Inline reply composer at bottom
- Keyboard: `]` next thread, `[` previous thread

### 4-6. Compose

- Full-window overlay (not modal)
- To / CC / BCC with autocomplete from Gmail contacts API
- Subject, body (contenteditable with basic formatting)
- Send: `⌘Enter`
- Send & Archive: `⌘⇧Enter`
- Schedule send: pick datetime, stored as Gmail draft + local reminder
- Undo send: 10-second cancel window (matches Gmail default)

### 4-7. Snooze

- Implemented via Gmail API: remove `INBOX` label, apply custom label `zenmail/snoozed`
- Local SQLite stores `{ threadId, snoozeUntil }` 
- Background Electron timer checks every minute; re-applies `INBOX` label when due
- Preset options in picker: Later today · Tomorrow morning · Next week · Custom

### 4-8. Search

- Passes query string directly to Gmail API `threads.list?q=` (supports full Gmail search syntax)
- Local SQLite full-text search for offline/instant results (synced on open)
- Focus: `/`  |  Dismiss: `Escape`

---

## 5. UI design spec

### Layout

```
┌─────────────────────────────────────────────────────┐
│ Toolbar: [← →] [Search] [Compose]          [⚙]     │
├────────────┬────────────────────────────────────────┤
│            │  Thread list (virtualized)              │
│  Sidebar   │  ● Sender         Subject    10:23am   │
│  - Inbox   │    Sender         Subject    Yesterday │
│  - Sent    ├────────────────────────────────────────┤
│  - Drafts  │                                        │
│  ─────     │  Thread view                           │
│  Labels    │  (sandboxed HTML render)               │
│  + label   │                                        │
│            │  [Reply composer]                      │
└────────────┴────────────────────────────────────────┘
```

### Design tokens (Tailwind config)

```js
// tailwind.config.ts
colors: {
  bg:      { DEFAULT: '#0f0f0f', subtle: '#1a1a1a', border: '#2a2a2a' },
  text:    { primary: '#ececec', secondary: '#8a8a8a', muted: '#555' },
  accent:  { DEFAULT: '#6366f1', hover: '#4f52d4' },  // indigo — adjustable
  label:   { red:'#ef4444', yellow:'#eab308', green:'#22c55e', blue:'#3b82f6', purple:'#a855f7' },
}
// Base: dark mode only for v1. Light mode in v2.
```

### Typography

- Font: `Inter` (bundled) or system `-apple-system`
- Thread list row height: `56px`
- Subject weight: `500` unread, `400` read
- Density target: show 15+ threads without scrolling on 1440p

### Keyboard navigation principles

- Every action reachable without mouse
- Single-key shortcuts active when thread list or thread view is focused
- No shortcut conflicts with macOS system shortcuts
- Shortcuts discoverable via ⌘K palette (shows key next to action name)

---

## 6. Data flow

```
Google OAuth
    │
    ▼
Main process (Node)
    │  stores tokens in Keychain
    │  calls Gmail REST API
    │  caches threads → SQLite
    │
    ▼  IPC (contextBridge)
Renderer process (React)
    │  Zustand store
    │  ┌─────────────────────┐
    │  │ threads[]           │
    │  │ activeThreadId      │
    │  │ labels[]            │
    │  │ snoozedThreads[]    │
    │  └─────────────────────┘
    │
    ▼
UI components
```

IPC channels:

```ts
// main → renderer
'mail:threads-updated'  // new threads from API poll
'mail:snooze-fired'     // snooze timer triggered

// renderer → main
'mail:fetch-threads'    // { labelIds, q, pageToken }
'mail:send'             // { to, subject, body, threadId? }
'mail:modify-labels'    // { threadId, addLabels, removeLabels }
'mail:snooze'           // { threadId, until: ISO string }
```

---

## 7. Project structure

```
zenmail/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── index.ts           # App entry, window creation
│   │   ├── auth.ts            # OAuth PKCE flow
│   │   ├── gmail.ts           # Gmail API wrapper
│   │   ├── cache.ts           # SQLite read/write
│   │   ├── snooze.ts          # Snooze timer daemon
│   │   └── ipc.ts             # IPC handler registration
│   ├── renderer/              # React app
│   │   ├── main.tsx           # React entry
│   │   ├── App.tsx            # Router + layout
│   │   ├── store/
│   │   │   └── mail.ts        # Zustand store
│   │   ├── components/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── ThreadList.tsx
│   │   │   ├── ThreadView.tsx
│   │   │   ├── Compose.tsx
│   │   │   ├── CommandPalette.tsx
│   │   │   ├── SnoozePicker.tsx
│   │   │   └── LabelPicker.tsx
│   │   └── hooks/
│   │       ├── useThreads.ts
│   │       ├── useKeyboard.ts
│   │       └── useGmail.ts
│   └── shared/
│       └── types.ts           # Shared TS types
├── forge.config.ts            # Electron Forge config
├── tailwind.config.ts
├── vite.renderer.config.ts
├── vite.main.config.ts
└── package.json
```

---

## 8. MVP build order

1. **Electron shell** — window, preload, contextBridge scaffold
2. **OAuth flow** — Google login, token storage in Keychain
3. **Gmail API wrapper** — `threads.list`, `threads.get`, `messages.send`, `labels.list`
4. **SQLite cache** — thread cache schema, read/write helpers
5. **Thread list** — virtualized list, unread state, j/k navigation
6. **Thread view** — sandboxed HTML render, collapse quoted text
7. **Compose window** — basic send, ⌘Enter shortcut
8. **Split inbox** — Primary / Other filter logic
9. **Label sidebar** — color dots, unread counts
10. **Command palette** — kbar setup, all actions wired
11. **Snooze** — label-based implementation + timer daemon
12. **Polish** — animations, transitions, focus ring styles, empty states

---

## 9. Out of scope (v1)

- AI features of any kind
- iOS / iPadOS app
- Non-Gmail accounts (Outlook, iCloud, IMAP)
- Team / shared inbox features
- Light mode (dark only for v1)
- Plugin system

---

## 10. Key dependencies

```json
{
  "electron": "^33.0.0",
  "react": "^19.0.0",
  "typescript": "^5.5.0",
  "tailwindcss": "^4.0.0",
  "zustand": "^5.0.0",
  "kbar": "^0.1.0",
  "@tanstack/react-virtual": "^3.0.0",
  "googleapis": "^144.0.0",
  "keytar": "^7.9.0",
  "better-sqlite3": "^11.0.0",
  "electron-forge": "^7.0.0"
}
```

---

## 11. Getting started (for Claude Code)

```bash
npm create electron-app@latest zenmail -- --template=vite-typescript
cd zenmail
npm install zustand kbar @tanstack/react-virtual googleapis keytar better-sqlite3
npm install -D tailwindcss @tailwindcss/vite
npx tailwindcss init
```

Start with `src/main/auth.ts` — once OAuth works and a token is printed to console, everything else follows.  
Gmail API explorer: https://developers.google.com/gmail/api/reference/rest

---

*Keep it zen. No AI. No noise. Just email.*
