// La page du contact : un seul HTML, tout le déchiffrement dans le navigateur
// (libsodium en WASM). L'URL de l'API vient de VITE_API_URL au build.
import { defineConfig } from 'vite'

export default defineConfig({
  // libsodium (WASM) pèse plus de 500 ko : un seul chunk, c'est voulu.
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1500 },
})
