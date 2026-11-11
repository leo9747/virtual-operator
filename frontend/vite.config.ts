import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Local-only app; the editor chunk is ~520 kB minified and cached after first load.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Keep the rich editor in its own long-lived, cacheable chunk.
        manualChunks(id) {
          if (/node_modules\/(@tiptap|prosemirror-|marked|linkifyjs|orderedmap|rope-sequence|w3c-keyname)/.test(id)) return 'editor';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
});
