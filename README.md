# Riley Job Hub

Mobile-first Progressive Web App for Riley LaMar's job search: **Profile**, **Resume**, and **Jobs**.

Built for iPhone Safari **Add to Home Screen** (standalone PWA).

## Open on iPhone

1. Deploy or host this folder over **HTTPS** (or open via a tunnel / local network IP while testing).
2. On iPhone, open the site in **Safari** (not Chrome).
3. Tap the **Share** button.
4. Scroll and tap **Add to Home Screen**.
5. Confirm the name (**Job Hub**) and tap **Add**.
6. Launch from the home screen icon for fullscreen standalone mode.

While browsing in Safari you will also see an in-app tip: Share -> Add to Home Screen.

## Local preview (desktop)

```bash
cd /workspace/riley-job-hub
python3 -m http.server 8765
```

Open `http://localhost:8765/` in a browser. Service workers need a secure context (localhost is fine).

## Features

- **Profile** - name, phone, email, address, notes; saves to `localStorage`
- **Reset from server data** - reloads `data/app-state.json` and overwrites local edits
- **Resume** - accordion experience cards with month/year selects, role type, bullet list Add/Remove, strength chips, target role select
- **Jobs** - applications with status badges, filter, add/edit modal, newest first
- **Export / Import JSON** - backup or restore all app data
- Offline shell via service worker; seed JSON prefers network so server updates apply

## Data merge rules

1. On first load, seed from `data/app-state.json` and cache in `localStorage`.
2. Later loads: **localStorage wins** until you tap **Reset from server data**.
3. Grok Bot (or any editor) can update `data/app-state.json` on the server; users pick up changes after Reset (or a fresh install with empty local storage).

## How Grok Bot updates the live site

1. Edit seed data in `data/app-state.json` (profile, resume jobs, applications).
2. Optionally bump the cache name in `sw.js` (e.g. `riley-job-hub-v2`) if you also changed shell assets and need clients to drop old caches.
3. Redeploy / sync the `/workspace/riley-job-hub/` folder to the hosting target.
4. On the phone app: open **Profile** -> **Reset from server data** to pull the new JSON (or clear site data / reinstall the home screen icon for a clean slate).
5. Hard-refresh Safari if testing in the browser tab so the updated service worker installs.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell + iOS meta tags |
| `styles.css` | Mobile-first, large taps, dark-friendly |
| `app.js` | Tabs, forms, persistence, import/export |
| `sw.js` | Service worker cache |
| `manifest.webmanifest` | PWA manifest |
| `icons/` | 192 / 512 / apple-touch icons |
| `data/app-state.json` | Server seed data |

## ASCII-only source

All source files use ASCII characters only (no fancy punctuation in code).
