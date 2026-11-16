import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(__dirname, 'web'),
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        admin: resolve(__dirname, 'web/admin.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [resolve(__dirname)],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/admin/api': 'http://127.0.0.1:8080',
    },
  },
});
