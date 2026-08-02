import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'; // Tambahkan ini

export default defineConfig({
  plugins: [
    react(), 
    visualizer({ open: true }) // Tambahkan ini
  ],
  // ... server dan build config lainnya
})