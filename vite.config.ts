import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The browser talks to /api on this origin. Gokapi sends no CORS headers, so
// the dev server forwards /api to it, as server.mjs does in production.
const gokapi = process.env.GOKAPI_URL ?? "http://127.0.0.1:53842"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
    host: "127.0.0.1",
    port: 5181,
    strictPort: true,
    allowedHosts: true,
    proxy: { "/api/": { target: gokapi, changeOrigin: true } },
  },
})
