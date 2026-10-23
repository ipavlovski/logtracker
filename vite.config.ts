import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { assetsDir: 'static' },
  server: {
    port: 5175,
    proxy: {
      '/api': 'http://127.0.0.1:3012',
      '/lc': 'http://127.0.0.1:3012',
    },
  },
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.ts'],
  },
} as any)
