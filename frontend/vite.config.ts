import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: 'all',
  },

  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          leaflet: ['leaflet', 'react-leaflet'],
          query: ['@tanstack/react-query'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
