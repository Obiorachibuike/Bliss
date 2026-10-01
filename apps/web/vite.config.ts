import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: {
    '@clipship/ui': resolve(__dirname, '../../packages/ui/src/index.tsx'),
    '@clipship/types': resolve(__dirname, '../../packages/types/src/index.ts'),
    '@clipship/api': resolve(__dirname, '../../packages/api/src/index.ts'),
    '@clipship/state': resolve(__dirname, '../../packages/state/src/index.ts'),
  } },
  server: {
    host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true,
    fs: { allow: [resolve(__dirname, '../..')] },
    proxy: { '/api': { target: process.env.CLIPSHIP_API_TARGET || 'http://127.0.0.1:8000', ws: true } },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});
