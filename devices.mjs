// /devices: pair and unpair gokapi-android devices with the Cloudflare relay,
// the web version of ~/docker/files/bin/pair (add, remove, list). Node
// built-ins only.
//
// Authorization comes from the caller's own Gokapi key (the `apikey` header):
// every Gokapi key operation runs with it, so Gokapi enforces API_MOD, and KV
// is written or deleted only after Gokapi has accepted one of those
// operations. The server stores no Gokapi key.
//
// State is shared with bin/pair: secrets/pairs.json, same format, written
// atomically with mode 0600. Pairing links and secrets are returned once and
// never stored or logged.
import { createHash, randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const DEVICE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/
export const PERMISSIONS = ["PERM_VIEW", "PERM_UPLOAD", "PERM_DOWNLOAD", "PERM_DELETE"]
const NAME_RULE =
  "device names use lowercase letters, digits, and dashes (at most 32), such as pixel-9"
const NO_API_MOD =
  "This API key lacks the API management permission (Manage API keys). Grant it in Gokapi's admin page under API, or sign in with a key that has it."

class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

// errorcodes.InvalidApiKey in Gokapi v2.2.4.
const GOKAPI_INVALID_KEY = 2

const noApiMod = () => new HttpError(403, NO_API_MOD, "no-api-mod")

// --- config -----------------------------------------------------------------

function parseEnvFile(text) {
  const out = {}
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2)
      value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, "")
    out[match[1]] = value
  }
  return out
}

// Read on every request, so a new token or .env value needs no restart.
// Process environment wins over the .env file.
async function loadConfig(env) {
  const home = os.homedir()
  const filesDir = env.GOKAPI_FILES_DIR ?? path.join(home, "docker", "files")
  const envFile = env.GOKAPI_ENV_FILE ?? path.join(filesDir, ".env")
  const fromFile = await readFile(envFile, "utf8").then(parseEnvFile, () => ({}))
  const get = (name) => env[name] ?? fromFile[name] ?? ""
  return {
    publicUrl: get("GOKAPI_PUBLIC_URL").replace(/\/+$/, ""),
    relayDomain: get("RELAY_DOMAIN"),
    namespaceId: get("RELAY_KV_NAMESPACE_ID"),
    accountId: get("CLOUDFLARE_ACCOUNT_ID"),
    cloudflareApi: (get("CLOUDFLARE_API_URL") || "https://api.cloudflare.com/client/v4").replace(/\/+$/, ""),
    tokenFile: get("CF_KV_TOKEN_FILE") || path.join(filesDir, "secrets", "cf-kv-token"),
    stateFile: get("PAIR_STATE_FILE") || path.join(filesDir, "secrets", "pairs.json"),
  }
}

const unavailable = (message) => new HttpError(503, message, "not-configured")

// Same checks as bin/pair's require_relay_config, plus the Cloudflare account
// and the KV token that replace its wrangler login.
async function requireRelayConfig(config) {
  if (!/^https:\/\/[^/]+$/.test(config.publicUrl))
    throw unavailable("GOKAPI_PUBLIC_URL must be the https:// origin of the tailnet files host")
  if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(config.relayDomain) || !config.relayDomain.includes("."))
    throw unavailable(
      "RELAY_DOMAIN must be the relay Worker's hostname, such as files-api.example.com; run just relay-setup"
    )
  if (!/^[0-9a-f]{32}$/.test(config.namespaceId))
    throw unavailable("RELAY_KV_NAMESPACE_ID is not set; run just relay-setup")
  if (!/^[0-9a-f]{32}$/.test(config.accountId))
    throw unavailable("CLOUDFLARE_ACCOUNT_ID is not set; add the account ID from wrangler whoami to .env")
  return { ...config, token: await readSecret("Cloudflare KV token", config.tokenFile) }
}

async function readSecret(name, file) {
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) throw unavailable(`${name} not found: ${file}`)
  if (info.mode & 0o077)
    throw unavailable(`${file} must not be accessible by group or others: chmod 600 ${file}`)
  const value = (await readFile(file, "utf8")).replace(/[\r\n]/g, "")
  if (!value) throw unavailable(`${name} is empty`)
  return value
}

// --- state (shared with bin/pair) ---------------------------------------------

async function readState(file) {
  const text = await readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return ""
    throw error
  })
  if (!text.trim()) return { devices: [] }
  let state
  try {
    state = JSON.parse(text)
  } catch {
    state = null
  }
  if (!Array.isArray(state?.devices)) throw new HttpError(500, `unexpected state in ${file}`)
  return state
}

// jq's default output (two-space indent, trailing newline) is what bin/pair
// writes; JSON.stringify(…, 2) produces the same bytes for this shape.
async function writeState(file, state) {
  const dir = path.dirname(file)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const tmp = path.join(dir, `.pairs.${randomBytes(6).toString("hex")}`)
  try {
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" })
    await chmod(tmp, 0o600)
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

// One state change at a time in this process. bin/pair and this server can
// still race each other, as two bin/pair runs can; pairing is rare and manual.
let queue = Promise.resolve()
function serialized(task) {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

// --- Gokapi, with the caller's key --------------------------------------------

function gokapiClient(gokapiUrl, callerKey, forwardedFor) {
  return async (method, apiPath, headers = {}) => {
    let response
    try {
      response = await fetch(new URL(`/api/${apiPath}`, gokapiUrl), {
        method,
        headers: { apikey: callerKey, accept: "application/json", "x-forwarded-for": forwardedFor, ...headers },
        signal: AbortSignal.timeout(60_000),
      })
    } catch {
      return { status: 0, body: null }
    }
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    return { status: response.status, body }
  }
}

const ok = (result) => result.status >= 200 && result.status < 300

// "<what> failed with HTTP <status>", plus Gokapi's own message, as bin/pair's
// report prints.
function report(what, result) {
  const detail = result.body?.ErrorMessage ?? result.body?.errors?.[0]?.message
  const status = result.status === 0 ? "000" : result.status
  return `${what} failed with HTTP ${status}${detail ? `: ${detail}` : ""}`
}

// Gokapi checks the key's API permission before it parses headers, so
// auth/delete without targetKey answers 400 to a key with API_MOD and 401 to
// any other key, and deletes nothing either way.
async function requireApiMod(gokapi) {
  const result = await gokapi("DELETE", "auth/delete")
  if (result.status === 400) return
  if (result.status === 401) throw noApiMod()
  throw new HttpError(502, report("checking the API key", result))
}

// --- Cloudflare KV --------------------------------------------------------------

async function kv(config, method, key, value) {
  const url = `${config.cloudflareApi}/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}/values/${encodeURIComponent(key)}`
  try {
    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${config.token}` },
      body: value,
      signal: AbortSignal.timeout(30_000),
    })
    const body = await response.json().catch(() => null)
    return { status: response.status, body, ok: response.ok && body?.success !== false }
  } catch {
    return { status: 0, body: null, ok: false }
  }
}

// --- operations ------------------------------------------------------------------

const base64url = (buffer) => buffer.toString("base64url")
const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z")

export function pairingLink(publicUrl, fields) {
  // Key order is the contract with Pairing.kt and bin/pair.
  const payload = {
    v: 1,
    name: fields.name,
    url: publicUrl,
    key: fields.key,
    relay: fields.relay,
    relayId: fields.relayId,
    relaySecret: fields.relaySecret,
  }
  return `${publicUrl}/pair#${base64url(Buffer.from(JSON.stringify(payload), "utf8"))}`
}

const publicDevice = ({ name, relayId, gokapiKeyId, created }) => ({ name, relayId, gokapiKeyId, created })

async function listDevices(ctx) {
  await requireApiMod(ctx.gokapi)
  const config = await loadConfig(ctx.env)
  const state = await readState(config.stateFile)
  return { status: 200, body: { devices: state.devices.map(publicDevice) } }
}

async function addDevice(ctx, device) {
  if (typeof device !== "string" || !DEVICE_NAME.test(device)) throw new HttpError(400, NAME_RULE)
  const config = await requireRelayConfig(await loadConfig(ctx.env))
  const { gokapi } = ctx

  return serialized(async () => {
    const state = await readState(config.stateFile)
    if (state.devices.some((entry) => entry.name === device))
      throw new HttpError(409, `${device} is already paired; unpair it first`)

    const created = await gokapi("POST", "auth/create", {
      friendlyName: `gokapi-${device}`,
      basicPermissions: "false",
    })
    if (created.status === 401) throw noApiMod()
    if (!ok(created)) throw new HttpError(502, report("creating the Gokapi API key", created))
    const key = created.body?.Id
    const keyId = created.body?.PublicId
    if (!key || !keyId) throw new HttpError(502, "unexpected Gokapi auth/create response")

    const warnings = []
    const rollbackKey = async () => {
      const result = await gokapi("DELETE", "auth/delete", { targetKey: keyId })
      if (!ok(result))
        warnings.push(`${report(`rolling back Gokapi key ${keyId}`, result)}; delete it in Gokapi's API menu`)
    }
    const fail = async (status, message) => {
      await rollbackKey()
      throw new HttpError(status, [message, ...warnings].join(". "))
    }

    for (const permission of PERMISSIONS) {
      const granted = await gokapi("PUT", "auth/modify", {
        targetKey: keyId,
        permission,
        permissionModifier: "GRANT",
      })
      if (!ok(granted)) await fail(502, report(`granting ${permission}`, granted))
    }

    // Gokapi has accepted the caller's key for the operations above, so the
    // KV write is authorized. The relay stores only the secret's SHA-256.
    const relayId = `${device}-${randomBytes(4).toString("hex")}`
    const relaySecret = base64url(randomBytes(32))
    const hash = createHash("sha256").update(relaySecret).digest("hex")
    const createdAt = isoSeconds(new Date())
    const put = await kv(config, "PUT", `device:${relayId}`, JSON.stringify({ name: device, hash, created: createdAt }))
    if (!put.ok) await fail(502, report("writing the relay credential to KV", put))

    const entry = { name: device, relayId, gokapiKeyId: keyId, created: createdAt }
    try {
      await writeState(config.stateFile, { ...state, devices: [...state.devices, entry] })
    } catch {
      const removed = await kv(config, "DELETE", `device:${relayId}`)
      if (!removed.ok) warnings.push(report(`deleting relay credential device:${relayId}`, removed))
      await fail(500, `writing ${config.stateFile} failed`)
    }

    const link = pairingLink(config.publicUrl, {
      name: device,
      key,
      relay: `https://${config.relayDomain}`,
      relayId,
      relaySecret,
    })
    return { status: 201, body: { device: publicDevice(entry), link } }
  })
}

async function removeDevice(ctx, device) {
  if (!DEVICE_NAME.test(device)) throw new HttpError(400, NAME_RULE)
  const config = await requireRelayConfig(await loadConfig(ctx.env))
  const { gokapi } = ctx

  return serialized(async () => {
    const state = await readState(config.stateFile)
    const entry = state.devices.find((candidate) => candidate.name === device)
    if (!entry) throw new HttpError(404, `${device} is not paired`)
    const { gokapiKeyId: keyId, relayId } = entry

    // bin/pair deletes KV first, which revokes relay access at once. Before
    // that, have Gokapi accept the caller's key for this exact key ID: setting
    // its name to the one bin/pair gave it changes nothing that matters,
    // and needs API_MOD plus the right to edit that key. 404 means the key is
    // already gone, which Gokapi only reveals to a key with API_MOD; then
    // there is no owner left to check, and the relay credential is useless
    // without the key anyway.
    const check = await gokapi("PUT", "auth/friendlyname", {
      targetKey: keyId,
      friendlyName: `gokapi-${device}`,
    })
    // ErrorCode 2 is Gokapi's invalid-key code, which it also sends for a key
    // without API_MOD. Other 401s mean this key belongs to another user.
    if (check.status === 401)
      throw check.body?.ErrorCode === GOKAPI_INVALID_KEY
        ? noApiMod()
        : new HttpError(403, report(`editing Gokapi key ${keyId}`, check), "not-owner")
    if (!ok(check) && check.status !== 404) throw new HttpError(502, report(`checking Gokapi key ${keyId}`, check))

    const removed = await kv(config, "DELETE", `device:${relayId}`)
    if (!removed.ok)
      throw new HttpError(
        502,
        `${report(`deleting relay credential device:${relayId}`, removed)}. Kept ${device}; deleting its relay credential failed, unpair it again`
      )

    const warnings = []
    const deleted = check.status === 404 ? { status: 404 } : await gokapi("DELETE", "auth/delete", { targetKey: keyId })
    if (!ok(deleted)) {
      if (deleted.status === 404) warnings.push(`Gokapi has no key ${keyId}; check the API menu`)
      else
        throw new HttpError(
          502,
          `${report(`deleting Gokapi key ${keyId}`, deleted)}. Kept ${device}; its relay credential is revoked, unpair it again`
        )
    }

    const current = await readState(config.stateFile)
    await writeState(config.stateFile, {
      ...current,
      devices: current.devices.filter((candidate) => candidate.name !== device),
    })
    return {
      status: 200,
      body: {
        message: `Removed ${device}. Its relay credential and Gokapi key are revoked.`,
        note: "The relay may still accept the credential for up to a minute while edge caches expire.",
        warnings,
      },
    }
  })
}

// --- HTTP -------------------------------------------------------------------------

const MAX_BODY = 1024

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on("data", (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, "request body too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"))
      } catch {
        reject(new HttpError(400, "request body must be JSON"))
      }
    })
    req.on("error", reject)
  })
}

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    // The pair response carries a credential.
    "Cache-Control": "no-store",
  })
  res.end(text)
}

/** Handles /devices and /devices/<name>. `gokapiUrl` is the loopback Gokapi. */
export async function handleDevices(req, res, { gokapiUrl, env = process.env }) {
  try {
    const { pathname } = new URL(req.url, "http://x")
    const header = req.headers.apikey
    const callerKey = Array.isArray(header) ? header[0] : header
    if (!callerKey || !/^[\x21-\x7e]{1,256}$/.test(callerKey))
      throw new HttpError(401, "Sign in with a Gokapi API key.", "no-key")
    // Same X-Forwarded-For as server.mjs's /api proxy, so Gokapi's per-IP
    // rate limit and logs see the real client behind dev-route.
    const client = req.socket.remoteAddress ?? ""
    const forwardedFor = req.headers["x-forwarded-for"] ? `${req.headers["x-forwarded-for"]}, ${client}` : client
    const ctx = { env, gokapi: gokapiClient(gokapiUrl, callerKey, forwardedFor) }

    let result
    if (pathname === "/devices" && req.method === "GET") result = await listDevices(ctx)
    else if (pathname === "/devices" && req.method === "POST") {
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
        throw new HttpError(415, "send the device name as JSON")
      const body = await readJson(req)
      result = await addDevice(ctx, body?.name)
    } else if (pathname.startsWith("/devices/") && req.method === "DELETE")
      result = await removeDevice(ctx, pathname.slice("/devices/".length))
    else throw new HttpError(404, "not found")
    send(res, result.status, result.body)
  } catch (error) {
    if (error instanceof HttpError) return send(res, error.status, { error: error.message, code: error.code })
    // Never log the error object: it could hold request details.
    console.error("devices: unexpected failure")
    send(res, 500, { error: "Unexpected server error." })
  }
}
