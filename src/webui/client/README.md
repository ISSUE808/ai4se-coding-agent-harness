# CodeHarness WebUI client

React SPA for the CodeHarness WebUI (PLAN Task 18a): Dashboard (session list /
new session) and Settings (API key management + Monaco JSON config editor).

- Stack: Vite + React 19 + TypeScript, react-router-dom, @monaco-editor/react
  (Monaco bundled locally via npm — no CDN), lucide-react icons.
- **Design**: every color/font-size/spacing references `src/design-tokens.ts`
  (`designTokens`); no hardcoded values anywhere (verified by grep).
- **API**: talks to `src/webui/server.ts` (Task 17) — `POST/GET /api/sessions`,
  `/api/keys/:provider`, `/api/config`. Dev proxy: `/api` → `http://localhost:3000`.

## Scripts

```sh
npm run dev       # vite dev server (proxies /api to the backend)
npm test          # vitest run (jsdom + testing-library)
npm run build     # tsc -b && vite build
```

The backend (src/webui/server.ts) must be running on port 3000 for real data;
without it the Dashboard shows its error state.
