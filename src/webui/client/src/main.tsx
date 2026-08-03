import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import designTokens from './design-tokens';
import App from './App.tsx';
import './global.css';

// Monaco loaded from the local npm package (no CDN): wire the ESM workers and
// hand the instance to @monaco-editor/react's loader.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'json') {
      return new jsonWorker();
    }
    return new editorWorker();
  },
};
loader.config({ monaco });

// Global page surface from the design tokens — everything else is inline.
const body = document.body;
body.style.margin = '0';
body.style.background = designTokens.colors.bg;
body.style.color = designTokens.colors.text;
body.style.fontFamily = designTokens.typography.fontFamily.sans;
body.style.fontSize = designTokens.typography.fontSize.base;
// Prototype body uses line-height 1.5 — without it, inherited `normal` (~1.2)
// makes multi-line mono/system text rows overlap visually.
body.style.lineHeight = String(designTokens.typography.lineHeight.normal);

// CSS variables consumed by global.css (scrollbar / focus / keyframes) — the
// token file remains the only place raw values are written.
const root = document.documentElement;
root.style.setProperty('--ch-bg', designTokens.colors.bg);
root.style.setProperty('--ch-border-strong', designTokens.colors.borderStrong);
root.style.setProperty('--ch-focus-ring', designTokens.colors.focusRing);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
