import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 🆕 FIX P1 "vite.config.ts memakai allowedHosts: all; batasi untuk
// production" (audit driver-jobs). `allowedHosts: 'all'` mematikan
// validasi header Host sama sekali di dev server Vite -- ini melindungi
// dari serangan DNS rebinding (situs jahat yang bikin browser korban
// mengirim request ke localhost/dev-server lewat domain yang di-resolve
// ke 127.0.0.1). Aman-aman saja untuk development lokal biasa, tapi
// kalau dev server ini pernah dijalankan di staging/environment yang
// bisa diakses lebih luas, wildcard ini membuka celah yang tidak
// perlu. Sekarang HANYA aktif saat development; default Vite (host
// header divalidasi normal) dipakai untuk kondisi lain.
const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: isDev ? 'all' : undefined,
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
          charts: ['recharts'],
        },
      },
    },
  },
})
