/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // The Pages workflow passes the base path GitHub Pages reports: the root on
  // the custom domain (planner.metal-stack.io), /<repo>/ on a fork's project
  // site, which keeps forks working without editing this file. Local builds and
  // `npm run preview` keep the root default.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
  },
})
