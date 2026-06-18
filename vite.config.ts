import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves this project under /raindrop_chess/; locally serve from root.
  base: process.env.GITHUB_ACTIONS ? '/raindrop_chess/' : '/',
})
