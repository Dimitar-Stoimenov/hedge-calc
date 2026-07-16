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
    // calc.ts is pure and the App render test uses react-dom/server (no DOM),
    // so a node environment is enough — no jsdom needed.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
