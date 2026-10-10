import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    fs: { allow: ['.', '../shared'] },
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 900 },
});
