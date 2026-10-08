import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors tsconfig.json's `~/*` -> `src/vendor/*` path mapping, needed
      // because src/vendor/** (machine-generated from upstream i18n-ally)
      // uses bare `~/...` imports internally.
      '~': fileURLToPath(new URL('./src/vendor', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
