# CouchBox Web (Frontend)

Frontend monorepo for **CouchBox** (10-foot Smart TV Launcher + Phone Remote PWA).
Pairs with the Rust/Tauri v2 backend at `~/RustroverProjects/couchbox-server`.

## Apps

- `apps/tv-ui` — React + TypeScript + Vite 10-foot TV UI rendered inside the Tauri v2 window.
- `apps/remote-pwa` — Mobile-first Phone Remote PWA embedded into the Rust backend (`rust-embed`) and served over local Wi-Fi.

## Commands

```bash
npm run install:all
npm run build        # builds both apps/remote-pwa/dist and apps/tv-ui/dist
npm run dev:tv       # Vite dev server for TV UI (http://localhost:1420)
npm run dev:remote   # Vite dev server for Remote PWA (http://localhost:1421)
```
