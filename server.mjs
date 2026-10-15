// Serves the built app from dist/ and forwards /api/* to Gokapi on the same
// origin, because Gokapi sends no CORS headers. No dependencies: run with
// `node server.mjs`. Listens on loopback only; dev-route publishes it on the
// tailnet.
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HOST = process.env.HOST ?? "127.0.0.1"
const PORT = Number(process.env.PORT ?? 53844)
const GOKAPI = new URL(process.env.GOKAPI_URL ?? "http://127.0.0.1:53842")
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist")

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
}

// The M3 theme provider writes a <style> tag at runtime, hence
// 'unsafe-inline' for styles. Thumbnails are blob: URLs.
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
}

// Hop-by-hop headers must not be forwarded.
const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "host",
])

function forward(req, res) {
  const headers = {}
  for (const [name, value] of Object.entries(req.headers))
    if (!HOP.has(name)) headers[name] = value
  headers.host = GOKAPI.host
  // Gokapi trusts X-Forwarded-For from 127.0.0.1 (GOKAPI_TRUSTED_PROXIES).
  const client = req.socket.remoteAddress ?? ""
  headers["x-forwarded-for"] = req.headers["x-forwarded-for"]
    ? `${req.headers["x-forwarded-for"]}, ${client}`
    : client

  const upstream = http.request(
    {
      host: GOKAPI.hostname,
      port: GOKAPI.port || 80,
      method: req.method,
      path: req.url,
      headers,
    },
    (response) => {
      const out = {}
      for (const [name, value] of Object.entries(response.headers))
        if (!HOP.has(name)) out[name] = value
      res.writeHead(response.statusCode ?? 502, out)
      response.pipe(res)
    }
  )
  upstream.on("error", () => {
    if (res.headersSent) return res.destroy()
    res.writeHead(502, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ Result: "error", ErrorMessage: "Gokapi is not reachable." }))
  })
  req.on("aborted", () => upstream.destroy())
  req.pipe(upstream)
}

async function serveFile(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" })
    return res.end()
  }
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname)
  let file = path.normalize(path.join(ROOT, pathname))
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403)
    return res.end()
  }
  let info = await stat(file).catch(() => null)
  // Unknown paths get the app shell; there is only one screen.
  if (!info?.isFile()) {
    file = path.join(ROOT, "index.html")
    info = await stat(file).catch(() => null)
    if (!info) {
      res.writeHead(500, { "Content-Type": "text/plain" })
      return res.end("dist/ is missing. Run `just build`.")
    }
  }
  const hashed = file.includes(`${path.sep}assets${path.sep}`)
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  })
  if (req.method === "HEAD") return res.end()
  createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/")) return forward(req, res)
  serveFile(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
})

// Large chunk uploads can take a while on slow links.
server.requestTimeout = 0
server.listen(PORT, HOST, () => {
  console.log(`gokapi-admin on http://${HOST}:${PORT}, forwarding /api to ${GOKAPI.origin}`)
})
