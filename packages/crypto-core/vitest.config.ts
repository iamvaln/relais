import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Argon2id MODERATE (256 Mo) prend quelques secondes en WASM.
    testTimeout: 60_000,
  },
})
