// Client for the Gokapi v2.2.4 REST API. Requests go to the same origin:
// Vite's dev proxy or server.mjs forwards /api to Gokapi. Every call sends the
// API key in the `apikey` header, as gokapi-android and bin/share do.

export interface GokapiFile {
  Id: string
  Name: string
  Size: string
  SizeBytes: number
  HotlinkId: string
  ContentType: string
  ExpireAt: number
  UploadDate: number
  UrlDownload: string
  UrlHotlink: string
  DownloadsRemaining: number
  DownloadCount: number
  UnlimitedDownloads: boolean
  UnlimitedTime: boolean
  IsPasswordProtected: boolean
  IsEndToEndEncrypted: boolean
  IsPendingDeletion: boolean
  IsFileRequest: boolean
}

export interface UploadLimits {
  maxFileBytes: number
  chunkBytes: number
}

export interface UploadOptions {
  expiryDays: number
  allowedDownloads: number
  password: string
}

export interface FileChanges {
  allowedDownloads: number
  expiryTimestamp: number
  /** null keeps the current password; "" removes it */
  password: string | null
}

export class ApiError extends Error {
  readonly status: number
  /** server.mjs's /devices error code, such as "no-api-mod" */
  readonly code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** A row of the pairs.json that server.mjs shares with bin/pair. No secrets. */
export interface PairedDevice {
  name: string
  relayId: string
  gokapiKeyId: string
  /** ISO-8601 UTC */
  created: string
}

export interface PairResult {
  device: PairedDevice
  /** The pairing link. A credential: show it once, never store it. */
  link: string
}

export interface UnpairResult {
  message: string
  note: string
  warnings: string[]
}

export const DEVICE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/

const MIB = 1024 * 1024
// Gokapi rejects chunks under 5 MB unless they are the last one.
const MIN_CHUNK = 5 * MIB

// Gokapi answers 401 both for a wrong key and for a missing permission.
function permissionMessage(permission: string) {
  return `The API key was rejected or lacks the ${permission} permission.`
}

export class GokapiClient {
  readonly key: string
  constructor(key: string) {
    this.key = key
  }

  private async request(
    path: string,
    permission: string,
    init: RequestInit = {}
  ): Promise<Response> {
    let response: Response
    try {
      response = await fetch(`/api/${path}`, {
        ...init,
        headers: { apikey: this.key, ...init.headers },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        throw error
      throw new ApiError(0, "Cannot reach Gokapi. Is the service running?")
    }
    if (response.ok) return response
    if (response.status === 401)
      throw new ApiError(401, permissionMessage(permission))
    const body = await response.json().catch(() => null)
    throw new ApiError(
      response.status,
      body?.ErrorMessage ?? `Gokapi answered ${response.status}.`
    )
  }

  // /devices is served by server.mjs, not Gokapi. It runs Gokapi's key
  // operations with this key, so the key needs API management.
  private async devicesRequest(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response
    try {
      response = await fetch(path, {
        ...init,
        cache: "no-store",
        headers: { apikey: this.key, ...init.headers },
      })
    } catch {
      throw new ApiError(0, "Cannot reach the gokapi-admin server.")
    }
    if (response.ok) return response
    const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null
    throw new ApiError(response.status, body?.error ?? `The server answered ${response.status}.`, body?.code)
  }

  async devices(): Promise<PairedDevice[]> {
    const response = await this.devicesRequest("/devices")
    return ((await response.json()) as { devices: PairedDevice[] }).devices
  }

  async pairDevice(name: string): Promise<PairResult> {
    const response = await this.devicesRequest("/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    })
    return (await response.json()) as PairResult
  }

  async unpairDevice(name: string): Promise<UnpairResult> {
    const response = await this.devicesRequest(`/devices/${encodeURIComponent(name)}`, { method: "DELETE" })
    return (await response.json()) as UnpairResult
  }

  async list(): Promise<GokapiFile[]> {
    const response = await this.request("files/list", "View files")
    // Gokapi returns null when no files are stored.
    return ((await response.json()) as GokapiFile[] | null) ?? []
  }

  async limits(): Promise<UploadLimits> {
    const response = await this.request("info/config", "Upload")
    const info = (await response.json()) as {
      MaxFilesize: number
      MaxChunksize: number
    }
    return {
      maxFileBytes: info.MaxFilesize * MIB,
      chunkBytes: Math.max(MIN_CHUNK, info.MaxChunksize * MIB),
    }
  }

  /** File bytes without using up a download. Needs the Download permission. */
  async download(id: string, signal?: AbortSignal): Promise<Blob> {
    const response = await this.request(`files/download/${encodeURIComponent(id)}`, "Download", {
      signal,
      headers: { increaseCounter: "false" },
    })
    return response.blob()
  }

  /** Deletes after `delaySeconds`, so `restore` can still cancel it. */
  async remove(id: string, delaySeconds = 0) {
    await this.request("files/delete", "Delete", {
      method: "DELETE",
      headers: { id, delay: String(delaySeconds) },
    })
  }

  async restore(id: string) {
    await this.request("files/restore", "Delete", {
      method: "POST",
      headers: { id },
    })
  }

  async modify(id: string, changes: FileChanges): Promise<GokapiFile> {
    const headers: Record<string, string> = {
      id,
      allowedDownloads: String(changes.allowedDownloads),
      expiryTimestamp: String(changes.expiryTimestamp),
    }
    if (changes.password === null) headers.originalPassword = "true"
    else headers.password = changes.password
    const response = await this.request("files/modify", "Edit", {
      method: "PUT",
      headers,
    })
    return (await response.json()) as GokapiFile
  }

  // Same chunk sequence as gokapi-android: chunk/add for each slice in order,
  // then chunk/complete with the file's metadata.
  async upload(
    file: File,
    options: UploadOptions,
    limits: UploadLimits,
    onProgress: (sentBytes: number) => void,
    signal: AbortSignal
  ): Promise<GokapiFile> {
    const uuid = crypto.randomUUID()
    let offset = 0
    do {
      const end = Math.min(offset + limits.chunkBytes, file.size)
      const chunk = file.slice(offset, end)
      const form = new FormData()
      form.append("uuid", uuid)
      form.append("filesize", String(file.size))
      form.append("offset", String(offset))
      form.append("file", chunk, "chunk")
      const start = offset
      await withRetries(() =>
        postChunk(this.key, form, (loaded) =>
          onProgress(start + Math.min(loaded, chunk.size)), signal)
      )
      offset = end
      onProgress(offset)
    } while (offset < file.size)

    const response = await this.request("chunk/complete", "Upload", {
      method: "POST",
      signal,
      headers: {
        uuid,
        filename: base64Header(file.name),
        filesize: String(file.size),
        contenttype: file.type || "application/octet-stream",
        expiryDays: String(options.expiryDays),
        allowedDownloads: String(options.allowedDownloads),
        password: options.password,
        nonblocking: "false",
      },
    })
    const result = (await response.json()) as { FileInfo: GokapiFile }
    return result.FileInfo
  }
}

// Headers must be ASCII. Gokapi decodes a "base64:" prefix on file names.
function base64Header(value: string) {
  let binary = ""
  for (const byte of new TextEncoder().encode(value))
    binary += String.fromCharCode(byte)
  return `base64:${btoa(binary)}`
}

async function withRetries<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      const retryable = error instanceof ApiError && error.status === 0
      if (!retryable || attempt === 3) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }
}

// XMLHttpRequest reports upload progress; fetch does not.
function postChunk(
  key: string,
  body: FormData,
  onProgress: (loaded: number) => void,
  signal: AbortSignal
) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted)
      return reject(new DOMException("Upload cancelled", "AbortError"))
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/chunk/add")
    xhr.setRequestHeader("apikey", key)
    xhr.upload.onprogress = (event) => onProgress(event.loaded)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      if (xhr.status === 401)
        return reject(new ApiError(401, permissionMessage("Upload")))
      let message = `Upload failed (${xhr.status}).`
      try {
        message = JSON.parse(xhr.responseText).ErrorMessage ?? message
      } catch {
        // Keep the status message.
      }
      reject(new ApiError(xhr.status, message))
    }
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload."))
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"))
    signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}
