import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  appType: "spa",
  plugins: [react()],
  server: {
    proxy: {
      // Apuntá a 3001 (Node) o 8080 (Spring/Tomcat). Mismo prefijo /api en ambos.
      '/api': 'http://localhost:8080',
    },
  },
})
