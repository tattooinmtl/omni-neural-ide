import { defineConfig } from 'vite';
import path from 'path';
export default defineConfig({
  base: './',
  publicDir: 'public',
  server: { port: 5173, host: '127.0.0.1', proxy: {
    '/api': 'http://127.0.0.1:8741',
    '/ws': { target: 'ws://127.0.0.1:8741', ws: true }
  }},
  build: { outDir: 'dist', emptyOutDir: true },
  resolve: { alias: { '@codicons': path.resolve(__dirname, 'node_modules/@vscode/codicons/dist') } },
});
