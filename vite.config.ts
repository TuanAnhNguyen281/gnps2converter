import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'framer-motion'] } } },
  },
  test: { exclude: ['node_modules/**', 'dist/**', 'dist-server/**'] },
});
