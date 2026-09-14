/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so the bundle has to be
  // built with that prefix. The Pages workflow passes it derived from the repo
  // name, which keeps forks working without editing this file. Local builds and
  // `npm run preview` keep the root default.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
  },
})
