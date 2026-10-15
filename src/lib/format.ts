import type { GokapiFile } from "@/lib/gokapi"

const UNITS = ["B", "KB", "MB", "GB", "TB"]

export function formatBytes(bytes: number) {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : 1)} ${UNITS[unit]}`
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
]

/** "in 3 days", "2 hours ago" for a Unix timestamp in seconds. */
export function fromNow(seconds: number, now = Date.now() / 1000) {
  const delta = seconds - now
  for (const [unit, size] of STEPS)
    if (Math.abs(delta) >= size) return relative.format(Math.round(delta / size), unit)
  return relative.format(Math.round(delta), "second")
}

export function expiryText(file: GokapiFile) {
  return file.UnlimitedTime ? "Never expires" : `Expires ${fromNow(file.ExpireAt)}`
}

export function downloadsText(file: GokapiFile) {
  const used = `${file.DownloadCount} ${file.DownloadCount === 1 ? "download" : "downloads"}`
  return file.UnlimitedDownloads
    ? used
    : `${used}, ${file.DownloadsRemaining} left`
}

// @icons image movie music_note picture_as_pdf description folder_zip android draft
/** Material Symbols name for a MIME type. */
export function fileIcon(contentType: string) {
  if (contentType.startsWith("image/")) return "image"
  if (contentType.startsWith("video/")) return "movie"
  if (contentType.startsWith("audio/")) return "music_note"
  if (contentType === "application/pdf") return "picture_as_pdf"
  if (contentType.startsWith("text/")) return "description"
  if (/zip|tar|compressed|7z|rar|gzip/.test(contentType)) return "folder_zip"
  if (contentType === "application/vnd.android.package-archive") return "android"
  return "draft"
}

/** Value for a datetime-local input, in local time. */
export function toLocalInput(seconds: number) {
  const date = new Date(seconds * 1000)
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function fromLocalInput(value: string) {
  return Math.floor(new Date(value).getTime() / 1000)
}
