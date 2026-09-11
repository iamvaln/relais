import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Argon2id MODERATE (PIN) prend ~1,5 s en WASM.
    testTimeout: 60_000,
  },
})
