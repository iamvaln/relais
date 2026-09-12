// Le back office : une SPA React servie derrière une authentification admin.
// L'URL de l'API vient de VITE_API_URL au build (comme apps/web-relay).
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022', sourcemap: false },
})
