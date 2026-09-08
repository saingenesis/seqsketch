import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleExport } from './portable/export.mjs';

export default defineConfig({
  plugins: [react(), {
    name: 'local-exports',
    configureServer(server) {
      server.middlewares.use('/__seqsketch_export', (request, response, next) => {
        if (request.method === 'POST') void handleExport(request, response); else next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__seqsketch_export', (request, response, next) => {
        if (request.method === 'POST') void handleExport(request, response); else next();
      });
    },
  }],
  base: './',
  resolve: {
    // PaperScript uses dynamic code generation, blocked by the portable server's CSP.
    alias: [{ find: /^paper$/, replacement: 'paper/dist/paper-core.js' }],
  },
});
