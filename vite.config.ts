import { resolve } from 'node:path';
import { defineConfig } from 'vite';

function serveRps(req: { url?: string }): void {
  const path = req.url?.split('?')[0];
  if (path !== '/rps' && path !== '/rps/') return;
  const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  req.url = `/rps.html${query}`;
}

export default defineConfig({
  root: resolve(__dirname, 'web'),
  // The project root is web/. Env files stay at the repo root so one .env.local feeds Vite and the API.
  envDir: resolve(__dirname),
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        admin: resolve(__dirname, 'web/admin.html'),
        rps: resolve(__dirname, 'web/rps.html'),
      },
    },
  },
  plugins: [
    {
      name: 'rps-page',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          serveRps(req);
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, _res, next) => {
          serveRps(req);
          next();
        });
      },
    },
  ],
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
