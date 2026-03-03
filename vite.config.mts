import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { createHtmlPlugin } from 'vite-plugin-html';

export default defineConfig({
  build: {
    assetsInlineLimit: 0,
  },
  plugins: [react(), createHtmlPlugin()],
  resolve: {
    alias: {
      '@': '/src',
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  server: {
    allowedHosts: true,
  },
});
