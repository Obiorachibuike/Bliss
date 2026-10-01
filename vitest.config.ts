import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: {
    '@clipship/types': resolve('packages/types/src/index.ts'),
    '@clipship/api': resolve('packages/api/src/index.ts'),
    '@clipship/state': resolve('packages/state/src/index.ts'),
  } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['packages/ui/src/test-setup.ts'], include: ['packages/**/*.test.{ts,tsx}'] },
});
