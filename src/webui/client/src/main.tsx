import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import designTokens from './design-tokens';
import App from './App.tsx';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
