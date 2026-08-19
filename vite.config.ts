/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the project site under /<repo>/, so assets must resolve
// relative to that base. Repo name = "hedge-calc".
// https://vite.dev/config/
export default defineConfig({
  base: '/hedge-calc/',
  plugins: [react()],
  test: {
    // calc.ts is pure and the App render test uses react-dom/server, so node is enough for
    // most of the suite and keeps it fast. The ONE file that needs a DOM (FxToast.test.tsx —
    // the toast's ×, its copy button and the live fetch) opts in with a
    // `// @vitest-environment jsdom` docblock rather than forcing jsdom on everything.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
