// In-memory stand-in for the Gokapi API routes this app uses, for UI work
// without touching real files. Any non-empty apikey is accepted, except
// "bad", which gets 401. Usage: node scripts/mock-gokapi.mjs [port]
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

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x")
    const key = header(req, "apikey")
    if (!key || key === "bad") return json(res, 401, { Result: "error", ErrorMessage: "Unauthorized", ErrorCode: 2 })
    const route = `${req.method} ${url.pathname}`

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
