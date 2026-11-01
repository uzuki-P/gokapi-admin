// In-memory stand-in for the Gokapi API routes this app uses, for UI work
// without touching real files. Any non-empty apikey is accepted, except
// "bad", which gets 401. Keys starting with "nomod" lack API management
// (auth/* answers 401), and keys starting with "other" have it but may not
// edit keys created by someone else.
//
// It also fakes the Cloudflare KV REST API under /client/v4 for /devices
// (point CLOUDFLARE_API_URL at http://127.0.0.1:<port>/client/v4). Any bearer
// token works except "bad-token".
//
// Test hooks: GET /mock/state, POST /mock/reset, and POST /mock/fail with a
// `route` header such as "PUT /api/auth/modify" or "PUT kv" to make that
// route fail until the next reset.
//
// Usage: node scripts/mock-gokapi.mjs [port]
import http from "node:http"

const PORT = Number(process.argv[2] ?? 53899)
const now = () => Math.floor(Date.now() / 1000)
const BASE = "https://files.example.test"

// A 2x2 PNG for image previews.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNk+M/AwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
  "base64"
)

let next = 1
const files = new Map()
const pending = new Map()
// PublicId -> { Id, FriendlyName, Permissions, Owner }
const apiKeys = new Map()
// KV key -> { value, account, namespace }
const kvStore = new Map()
const failing = new Set()
// Route and (fake) API key of each Gokapi call, for tests.
const apiCalls = []
let keyCounter = 0
// errorcodes in Gokapi v2.2.4
const INVALID_API_KEY = 2
const CANNOT_PARSE = 4
const NO_PERMISSION = 6

function make(name, type, size, extra = {}) {
  const id = `mock${String(next++).padStart(11, "0")}`
  const image = type.startsWith("image/") && type !== "image/svg+xml"
  const file = {
    Id: id,
    Name: name,
    Size: `${(size / 1024 / 1024).toFixed(1)} MB`,
    SizeBytes: size,
    HotlinkId: image ? `${id}.png` : "",
    ContentType: type,
    ExpireAt: now() + 7 * 86400,
    ExpireAtString: "",
    UploadDate: now() - next * 3600,
    UrlDownload: `${BASE}/d?id=${id}`,
    UrlHotlink: image ? `${BASE}/h/${id}.png` : "",
    DownloadsRemaining: 0,
    DownloadCount: 0,
    UnlimitedDownloads: true,
    UnlimitedTime: false,
    IsPasswordProtected: false,
    IsEndToEndEncrypted: false,
    IsPendingDeletion: false,
    IsFileRequest: false,
    ...extra,
  }
  files.set(id, file)
  return file
}

make("screenshot-2026-10-15.png", "image/png", 312_000, { DownloadCount: 4 })
make("report-q3.pdf", "application/pdf", 2_400_000, {
  UnlimitedDownloads: false,
  DownloadsRemaining: 2,
  DownloadCount: 3,
  IsPasswordProtected: true,
})
make("gokapi-android-0.4.0_15-oct_10-12.apk", "application/vnd.android.package-archive", 18_800_000, {
  UnlimitedTime: true,
})
make("trip-video.mp4", "video/mp4", 640_000_000, { ExpireAt: now() + 3 * 3600 })

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(body === undefined ? "" : JSON.stringify(body))
}

const header = (req, name) => {
  const value = req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function decodeName(value = "") {
  return value.startsWith("base64:") ? Buffer.from(value.slice(7), "base64").toString("utf8") : value
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0
    req.on("data", (chunk) => (size += chunk.length))
    req.on("end", () => resolve(size))
  })
}

function readText(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

const KV_PATH = /^\/client\/v4\/accounts\/([^/]+)\/storage\/kv\/namespaces\/([^/]+)\/values\/([^/]+)$/

// The Cloudflare v4 envelope: { success, errors, messages, result }.
async function fakeKv(req, res, match) {
  const cf = (status, success, errors = []) => json(res, status, { success, errors, messages: [], result: null })
  if (req.headers.authorization === "Bearer bad-token" || !req.headers.authorization?.startsWith("Bearer "))
    return cf(403, false, [{ code: 10000, message: "Authentication error" }])
  const [, account, namespace, rawKey] = match
  const key = decodeURIComponent(rawKey)
  if (failing.has(`${req.method} kv`)) return cf(500, false, [{ code: 10001, message: "injected failure" }])
  if (req.method === "PUT") {
    kvStore.set(key, { value: await readText(req), account, namespace })
    return cf(200, true)
  }
  if (req.method === "DELETE") {
    kvStore.delete(key)
    return cf(200, true)
  }
  if (req.method === "GET") {
    const entry = kvStore.get(key)
    if (!entry) return cf(404, false, [{ code: 10009, message: "get: 'key not found'" }])
    res.writeHead(200, { "Content-Type": "application/octet-stream" })
    return res.end(entry.value)
  }
  cf(405, false, [{ code: 10000, message: "method not allowed" }])
}

// Gokapi checks the key's permission first (401), then parses headers (400),
// then looks up the target key (404), then ownership (401).
function authRoute(req, res, route, key) {
  const error = (status, message, code) => json(res, status, { Result: "error", ErrorMessage: message, ErrorCode: code })
  if (key.startsWith("nomod")) return error(401, "Unauthorized", INVALID_API_KEY)
  if (failing.has(route)) return error(500, "injected failure", 1)
  if (route === "POST /api/auth/create") {
    keyCounter++
    const publicId = `mockpub${String(keyCounter).padStart(8, "0")}`
    const record = {
      Id: `mockkey${String(keyCounter).padStart(8, "0")}`,
      FriendlyName: header(req, "friendlyName") || "Unnamed key",
      Permissions: header(req, "basicPermissions") === "false" ? [] : ["PERM_VIEW", "PERM_UPLOAD"],
      Owner: key.startsWith("other") ? "other" : "admin",
    }
    apiKeys.set(publicId, record)
    return json(res, 200, { Result: "OK", Id: record.Id, PublicId: publicId })
  }
  const target = header(req, "targetKey")
  if (!target) return error(400, "header targetKey is required", CANNOT_PARSE)
  const record = apiKeys.get(target)
  if (!record) return error(404, "Invalid key ID provided.", 7)
  if (key.startsWith("other") && record.Owner !== "other")
    return error(401, "No permission to edit this API key", NO_PERMISSION)
  if (route === "PUT /api/auth/friendlyname") {
    record.FriendlyName = header(req, "friendlyName") || "Unnamed key"
    return json(res, 200)
  }
  if (route === "PUT /api/auth/modify") {
    const permission = header(req, "permission")
    if (header(req, "permissionModifier") === "GRANT") {
      if (!record.Permissions.includes(permission)) record.Permissions.push(permission)
    } else record.Permissions = record.Permissions.filter((p) => p !== permission)
    return json(res, 200)
  }
  if (route === "DELETE /api/auth/delete") {
    apiKeys.delete(target)
    return json(res, 200)
  }
  error(400, "Invalid request", 3)
}

const AUTH_ROUTES = new Set([
  "POST /api/auth/create",
  "PUT /api/auth/friendlyname",
  "PUT /api/auth/modify",
  "DELETE /api/auth/delete",
])

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x")
    const route = `${req.method} ${url.pathname}`

    if (route === "GET /mock/state")
      return json(res, 200, {
        apiKeys: Object.fromEntries(apiKeys),
        kv: Object.fromEntries(kvStore),
        apiCalls: apiCalls.slice(),
      })
    if (route === "POST /mock/reset") {
      apiKeys.clear()
      kvStore.clear()
      failing.clear()
      apiCalls.length = 0
      return json(res, 200)
    }
    if (route === "POST /mock/fail") {
      failing.add(header(req, "route"))
      return json(res, 200)
    }
    const kvMatch = KV_PATH.exec(url.pathname)
    if (kvMatch) return fakeKv(req, res, kvMatch)

    const key = header(req, "apikey")
    apiCalls.push({ route, apikey: key })
    if (!key || key === "bad") return json(res, 401, { Result: "error", ErrorMessage: "Unauthorized", ErrorCode: 2 })
    if (AUTH_ROUTES.has(route)) return authRoute(req, res, route, key)

    if (route === "GET /api/files/list") return json(res, 200, [...files.values()])
    if (route === "GET /api/info/config") return json(res, 200, { MaxFilesize: 102400, MaxChunksize: 45 })

    if (req.method === "GET" && url.pathname.startsWith("/api/files/download/")) {
      const file = files.get(decodeURIComponent(url.pathname.split("/").pop()))
      if (!file) return json(res, 404, { Result: "error", ErrorMessage: "Not found" })
      res.writeHead(200, { "Content-Type": file.ContentType })
      return res.end(file.ContentType.startsWith("image/") ? PNG : "mock")
    }

    if (route === "POST /api/chunk/add") {
      // Multipart parsing is not needed for a mock; count bytes per request.
      await readBody(req)
      await new Promise((resolve) => setTimeout(resolve, 400))
      return json(res, 200, { Result: "OK" })
    }

    if (route === "POST /api/chunk/complete") {
      const size = Number(header(req, "filesize"))
      const downloads = Number(header(req, "allowedDownloads") ?? 1)
      const days = Number(header(req, "expiryDays") ?? 14)
      const file = make(decodeName(header(req, "filename")), header(req, "contenttype") || "application/octet-stream", size, {
        UploadDate: now(),
        UnlimitedDownloads: downloads === 0,
        DownloadsRemaining: downloads,
        UnlimitedTime: days === 0,
        ExpireAt: now() + days * 86400,
        IsPasswordProtected: Boolean(header(req, "password")),
      })
      return json(res, 200, { Result: "OK", FileInfo: file, IncludeFilename: false })
    }

    if (route === "PUT /api/files/modify") {
      const file = files.get(header(req, "id"))
      if (!file) return json(res, 404, { Result: "error", ErrorMessage: "Not found" })
      const downloads = Number(header(req, "allowedDownloads"))
      const expiry = Number(header(req, "expiryTimestamp"))
      Object.assign(file, {
        UnlimitedDownloads: downloads === 0,
        DownloadsRemaining: downloads,
        UnlimitedTime: expiry === 0,
        ExpireAt: expiry || file.ExpireAt,
      })
      if (header(req, "originalPassword") !== "true") file.IsPasswordProtected = Boolean(header(req, "password"))
      return json(res, 200, file)
    }

    if (route === "DELETE /api/files/delete") {
      const id = header(req, "id")
      const file = files.get(id)
      if (!file) return json(res, 404, { Result: "error", ErrorMessage: "Not found" })
      files.delete(id)
      pending.set(id, file)
      setTimeout(() => pending.delete(id), Number(header(req, "delay") ?? 0) * 1000)
      return json(res, 200)
    }

    if (route === "POST /api/files/restore") {
      const id = header(req, "id")
      const file = pending.get(id)
      if (!file) return json(res, 404, { Result: "error", ErrorMessage: "Already deleted" })
      pending.delete(id)
      files.set(id, file)
      return json(res, 200, { Result: "OK", FileInfo: file })
    }

    json(res, 404, { Result: "error", ErrorMessage: `Mock has no ${route}` })
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock Gokapi on http://127.0.0.1:${PORT}`))
