import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // La logique testée ici (stores, i18n) n'importe rien de React Native.
    testTimeout: 30_000,
  },
})
