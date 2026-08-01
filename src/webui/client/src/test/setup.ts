// Vitest setup: jest-dom matchers + RTL auto-cleanup between tests.
// (globals:false — cleanup must be registered explicitly.)
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
