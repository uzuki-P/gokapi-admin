import * as React from "react"

import type { GokapiFile } from "@/lib/gokapi"

import { useSession } from "./session"

// Hotlinks count as downloads, so previews come from the API without
// touching the counter. Large images and SVG (never rendered from uploads)
// get the file icon instead.
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024
const RASTER = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/

const cache = new Map<string, string>()
let downloadAllowed = true

export function useThumbnail(file: GokapiFile) {
  const { client } = useSession()
  const eligible =
    RASTER.test(file.ContentType) && file.SizeBytes <= MAX_PREVIEW_BYTES && !file.IsEndToEndEncrypted
  const [url, setUrl] = React.useState(() => cache.get(file.Id) ?? null)

  React.useEffect(() => {
    if (!eligible || !downloadAllowed || cache.has(file.Id)) return
    const controller = new AbortController()
    client
      .download(file.Id, controller.signal)
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob)
        cache.set(file.Id, objectUrl)
        setUrl(objectUrl)
      })
      .catch((error: unknown) => {
        // A key without the Download permission: stop asking.
        if (error instanceof Error && "status" in error && error.status === 401) downloadAllowed = false
      })
    return () => controller.abort()
  }, [client, eligible, file.Id])

  return eligible ? url : null
}
