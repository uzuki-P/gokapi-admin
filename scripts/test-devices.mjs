// Tests server.mjs's /devices routes against scripts/mock-gokapi.mjs, which
// also fakes the Cloudflare KV API. Nothing here touches the real Gokapi or
// Cloudflare. The bin/pair tests run ~/docker/files/bin/pair against the same
// mock (with a fake wrangler) and check that both write the same formats.
// Run with `node --test scripts/test-devices.mjs` (part of `just check`).
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { after, before, beforeEach, describe, test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const BIN_PAIR = process.env.BIN_PAIR ?? path.join(os.homedir(), "docker", "files", "bin", "pair")
const NAMESPACE = "0123456789abcdef0123456789abcdef"
const ACCOUNT = "fedcba9876543210fedcba9876543210"
const PUBLIC_URL = "https://files.example.ts.net"
const RELAY = "files-api.example.com"
const ADMIN = "admin-key"
const KV_TOKEN = "fake-kv-token-value"

const children = []
let temp, mockUrl, serverUrl, stateFile, tokenFile, serverOutput

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
    probe.on("error", reject)
  })
}

async function start(args, env, ready) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] })
  children.push(child)
  let output = ""
  child.stdout.on("data", (chunk) => (output += chunk))
  child.stderr.on("data", (chunk) => (output += chunk))
  for (let i = 0; i < 100; i++) {
    if (await fetch(ready).then(() => true, () => false)) return () => output
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`${args.join(" ")} did not start:\n${output}`)
}

before(async () => {
  temp = mkdtempSync(path.join(os.tmpdir(), "gokapi-admin-devices-"))
  stateFile = path.join(temp, "secrets", "pairs.json")
  tokenFile = path.join(temp, "cf-kv-token")
  writeFileSync(tokenFile, `${KV_TOKEN}\n`, { mode: 0o600 })

  const mockPort = await freePort()
  mockUrl = `http://127.0.0.1:${mockPort}`
  await start(["scripts/mock-gokapi.mjs", String(mockPort)], process.env, `${mockUrl}/mock/state`)

  const port = await freePort()
  serverUrl = `http://127.0.0.1:${port}`
  serverOutput = await start(
    ["server.mjs"],
    {
      PATH: process.env.PATH,
      HOME: temp,
      HOST: "127.0.0.1",
      PORT: String(port),
      GOKAPI_URL: mockUrl,
      GOKAPI_ENV_FILE: path.join(temp, "absent.env"),
      GOKAPI_PUBLIC_URL: `${PUBLIC_URL}/`,
      RELAY_DOMAIN: RELAY,
      RELAY_KV_NAMESPACE_ID: NAMESPACE,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      CLOUDFLARE_API_URL: `${mockUrl}/client/v4`,
      CF_KV_TOKEN_FILE: tokenFile,
      PAIR_STATE_FILE: stateFile,
    },
    `${serverUrl}/index.html`
  )
})

after(() => {
  for (const child of children) child.kill()
  rmSync(temp, { recursive: true, force: true })
})

beforeEach(async () => {
  await fetch(`${mockUrl}/mock/reset`, { method: "POST" })
  rmSync(stateFile, { force: true })
  writeFileSync(tokenFile, `${KV_TOKEN}\n`, { mode: 0o600 })
  chmodSync(tokenFile, 0o600)
})

const mock = () => fetch(`${mockUrl}/mock/state`).then((r) => r.json())
const failNext = (route) => fetch(`${mockUrl}/mock/fail`, { method: "POST", headers: { route } })

async function call(method, pathname, { key = ADMIN, body } = {}) {
  const headers = {}
  if (key) headers.apikey = key
  if (body !== undefined) headers["content-type"] = "application/json"
  const response = await fetch(`${serverUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, headers: response.headers, body: await response.json() }
}

const pair = (name, key) => call("POST", "/devices", { key, body: { name } })
const unpair = (name, key) => call("DELETE", `/devices/${name}`, { key })
const state = () => JSON.parse(readFileSync(stateFile, "utf8"))

function decodeLink(link) {
  const prefix = `${PUBLIC_URL}/pair#`
  assert.ok(link.startsWith(prefix), link)
  const payload = link.slice(prefix.length)
  assert.match(payload, /^[A-Za-z0-9_-]+$/, "unpadded base64url")
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
}

// The exact formats bin/pair writes, field order included.
function assertFormats({ link, kvValue, stateText, name, gokapiKey, gokapiKeyId }) {
  const payload = decodeLink(link)
  assert.deepEqual(Object.keys(payload), ["v", "name", "url", "key", "relay", "relayId", "relaySecret"])
  assert.deepEqual(
    { v: payload.v, name: payload.name, url: payload.url, key: payload.key, relay: payload.relay },
    { v: 1, name, url: PUBLIC_URL, key: gokapiKey, relay: `https://${RELAY}` }
  )
  assert.match(payload.relayId, new RegExp(`^${name}-[0-9a-f]{8}$`))
  assert.match(payload.relaySecret, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(Buffer.from(payload.relaySecret, "base64url").length, 32)

  const record = JSON.parse(kvValue)
  assert.deepEqual(Object.keys(record), ["name", "hash", "created"])
  assert.match(record.created, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  const hash = createHash("sha256").update(payload.relaySecret).digest("hex")
  assert.equal(kvValue, JSON.stringify({ name, hash, created: record.created }), "compact JSON, jq -c order")

  const parsed = JSON.parse(stateText)
  assert.equal(stateText, `${JSON.stringify(parsed, null, 2)}\n`, "jq's default pretty print")
  const row = parsed.devices.find((device) => device.name === name)
  assert.deepEqual(Object.keys(row), ["name", "relayId", "gokapiKeyId", "created"])
  assert.deepEqual(row, { name, relayId: payload.relayId, gokapiKeyId, created: record.created })
  for (const secret of [payload.relaySecret, gokapiKey]) assert.ok(!stateText.includes(secret))
  return payload
}

describe("/devices", () => {
  test("listing needs a key with API management", async () => {
    assert.equal((await call("GET", "/devices", { key: null })).status, 401)
    const denied = await call("GET", "/devices", { key: "nomod-files-key" })
    assert.equal(denied.status, 403)
    assert.equal(denied.body.code, "no-api-mod")
    assert.match(denied.body.error, /API management/)
    const allowed = await call("GET", "/devices")
    assert.deepEqual([allowed.status, allowed.body], [200, { devices: [] }])
    // The probe is auth/delete without targetKey, which deletes nothing.
    const { apiCalls, apiKeys } = await mock()
    assert.deepEqual(apiCalls.map((c) => c.route), ["DELETE /api/auth/delete", "DELETE /api/auth/delete"])
    assert.deepEqual(apiKeys, {})
  })

  test("pairing matches bin/pair's link, KV value, and state row", async () => {
    const result = await pair("pixel-9")
    assert.equal(result.status, 201, JSON.stringify(result.body))
    assert.equal(result.headers.get("cache-control"), "no-store")
    const { apiKeys, kv, apiCalls } = await mock()
    const [[keyId, key]] = Object.entries(apiKeys)
    assert.deepEqual(key.Permissions, ["PERM_VIEW", "PERM_UPLOAD", "PERM_DOWNLOAD", "PERM_DELETE"])
    assert.equal(key.FriendlyName, "gokapi-pixel-9")
    assert.ok(apiCalls.every((c) => c.apikey === ADMIN), "every Gokapi call uses the caller's key")

    const kvKey = `device:${decodeLink(result.body.link).relayId}`
    assert.deepEqual(Object.keys(kv), [kvKey])
    assert.equal(kv[kvKey].account, ACCOUNT)
    assert.equal(kv[kvKey].namespace, NAMESPACE)
    assertFormats({
      link: result.body.link,
      kvValue: kv[kvKey].value,
      stateText: readFileSync(stateFile, "utf8"),
      name: "pixel-9",
      gokapiKey: key.Id,
      gokapiKeyId: keyId,
    })
    assert.equal(statSync(stateFile).mode & 0o777, 0o600)
    assert.deepEqual(result.body.device, state().devices[0])

    const listed = await call("GET", "/devices")
    assert.deepEqual(listed.body.devices, state().devices)
    assert.ok(!JSON.stringify(listed.body).includes(decodeLink(result.body.link).relaySecret))
  })

  test("each pairing gets fresh credentials; duplicates are refused", async () => {
    const first = decodeLink((await pair("phone")).body.link)
    const second = decodeLink((await pair("tablet")).body.link)
    assert.notEqual(first.relaySecret, second.relaySecret)
    assert.notEqual(first.key, second.key)
    const again = await pair("phone")
    assert.equal(again.status, 409)
    assert.equal(again.body.error, "phone is already paired; unpair it first")
    const { apiKeys, kv } = await mock()
    assert.equal(Object.keys(apiKeys).length, 2)
    assert.equal(Object.keys(kv).length, 2)
  })

  test("concurrent pairings are serialized into one state file", async () => {
    const results = await Promise.all(["a1", "b2", "c3", "d4"].map((name) => pair(name)))
    assert.ok(results.every((r) => r.status === 201))
    assert.deepEqual(state().devices.map((d) => d.name).sort(), ["a1", "b2", "c3", "d4"])
  })

  test("bad names are rejected before any call", async () => {
    for (const name of ["Pixel", "pixel_9", "../x", "-x", "", "a".repeat(33), 7]) {
      const result = await pair(name)
      assert.equal(result.status, 400, String(name))
      assert.match(result.body.error, /lowercase letters, digits, and dashes/)
    }
    assert.deepEqual((await mock()).apiCalls, [])
  })

  test("a key without API management cannot pair, and KV stays untouched", async () => {
    const result = await pair("pixel-9", "nomod-files-key")
    assert.equal(result.status, 403)
    assert.equal(result.body.code, "no-api-mod")
    const { apiKeys, kv } = await mock()
    assert.deepEqual([apiKeys, kv], [{}, {}])
    assert.ok(!existsSync(stateFile))
  })

  test("a failed grant rolls back the key before KV", async () => {
    await failNext("PUT /api/auth/modify")
    const result = await pair("pixel-9")
    assert.equal(result.status, 502)
    assert.match(result.body.error, /^granting PERM_VIEW failed with HTTP 500/)
    const { apiKeys, kv } = await mock()
    assert.deepEqual([apiKeys, kv], [{}, {}])
    assert.ok(!existsSync(stateFile))
  })

  test("a failed KV write rolls back the key and returns no link", async () => {
    await failNext("PUT kv")
    const result = await pair("pixel-9")
    assert.equal(result.status, 502)
    assert.match(result.body.error, /^writing the relay credential to KV failed with HTTP 500/)
    assert.equal(result.body.link, undefined)
    assert.deepEqual((await mock()).apiKeys, {})
    assert.ok(!existsSync(stateFile))
  })

  test("a failed rollback says where to clean up", async () => {
    await failNext("PUT kv")
    await failNext("DELETE /api/auth/delete")
    const result = await pair("pixel-9")
    assert.match(result.body.error, /rolling back Gokapi key mockpub\d+ failed .*delete it in Gokapi's API menu/)
  })

  test("pairing reports missing config and loose token files", async () => {
    chmodSync(tokenFile, 0o644)
    let result = await pair("pixel-9")
    assert.equal(result.status, 503)
    assert.match(result.body.error, /must not be accessible by group or others: chmod 600/)
    rmSync(tokenFile)
    result = await pair("pixel-9")
    assert.equal(result.status, 503)
    assert.match(result.body.error, /Cloudflare KV token not found/)
    assert.deepEqual((await mock()).apiCalls, [])
  })

  test("unpairing deletes KV, then the key, then the state row", async () => {
    const phone = decodeLink((await pair("phone")).body.link)
    const tablet = decodeLink((await pair("tablet")).body.link)
    const result = await unpair("phone")
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.message, "Removed phone. Its relay credential and Gokapi key are revoked.")
    const { apiKeys, kv } = await mock()
    assert.deepEqual(Object.keys(kv), [`device:${tablet.relayId}`])
    assert.deepEqual(Object.values(apiKeys).map((k) => k.Id), [tablet.key])
    assert.ok(!(`device:${phone.relayId}` in kv))
    assert.deepEqual(state().devices.map((d) => d.name), ["tablet"])
    assert.equal((await unpair("phone")).status, 404)
  })

  test("unpairing needs API management before KV is touched", async () => {
    await pair("phone")
    const result = await unpair("phone", "nomod-files-key")
    assert.equal(result.status, 403)
    assert.equal(result.body.code, "no-api-mod")
    const { apiKeys, kv } = await mock()
    assert.equal(Object.keys(kv).length, 1)
    assert.equal(Object.keys(apiKeys).length, 1)
    assert.equal(state().devices.length, 1)
  })

  test("unpairing another user's key is refused before KV is touched", async () => {
    await pair("phone")
    const result = await unpair("phone", "other-user-key")
    assert.equal(result.status, 403)
    assert.match(result.body.error, /No permission to edit this API key/)
    assert.equal(Object.keys((await mock()).kv).length, 1)
  })

  test("a failed KV delete keeps the device", async () => {
    await pair("phone")
    await failNext("DELETE kv")
    const result = await unpair("phone")
    assert.equal(result.status, 502)
    assert.match(result.body.error, /Kept phone; deleting its relay credential failed/)
    assert.equal(Object.keys((await mock()).apiKeys).length, 1)
    assert.equal(state().devices.length, 1)
  })

  test("a key already deleted in Gokapi still unpairs, with a warning", async () => {
    await pair("phone")
    const [keyId] = Object.keys((await mock()).apiKeys)
    await fetch(`${mockUrl}/api/auth/delete`, { method: "DELETE", headers: { apikey: ADMIN, targetKey: keyId } })
    const result = await unpair("phone")
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.warnings, [`Gokapi has no key ${keyId}; check the API menu`])
    assert.deepEqual((await mock()).kv, {})
    assert.deepEqual(state().devices, [])
  })

  test("the server never logs keys, secrets, or links", async () => {
    const { body } = await pair("pixel-9")
    const payload = decodeLink(body.link)
    await unpair("pixel-9")
    const output = serverOutput()
    for (const value of [body.link, payload.relaySecret, payload.key, KV_TOKEN, ADMIN])
      assert.ok(!output.includes(value))
  })
})

// bin/pair needs these, and its wrangler is replaced by a script that writes
// to the mock's fake KV.
const haveBinPair =
  existsSync(BIN_PAIR) &&
  ["bash", "curl", "jq", "base64", "sha256sum", "od", "mktemp", "column"].every(
    (command) => spawnSync("sh", ["-c", `command -v ${command}`]).status === 0
  )

describe("bin/pair interop", { skip: haveBinPair ? false : `${BIN_PAIR} or its tools are missing` }, () => {
  let wrangler
  before(() => {
    wrangler = path.join(temp, "fake-wrangler.mjs")
    writeFileSync(
      wrangler,
      `#!${process.execPath}
// wrangler kv key put|delete KEY [VALUE] --namespace-id ID --remote
const args = process.argv.slice(2)
const ns = args[args.indexOf("--namespace-id") + 1]
const positional = args.slice(3).filter((a, i, all) => a !== "--remote" && a !== "--namespace-id" && all[i - 1] !== "--namespace-id")
const url = process.env.FAKE_KV_URL + "/accounts/${ACCOUNT}/storage/kv/namespaces/" + ns + "/values/" + encodeURIComponent(positional[0])
const response = await fetch(url, { method: args[2] === "put" ? "PUT" : "DELETE", headers: { authorization: "Bearer x" }, body: positional[1] })
process.exit(response.ok ? 0 : 1)
`,
      { mode: 0o700 }
    )
  })

  function binPair(...args) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^(GOKAPI_|RELAY_|PAIR_|WRANGLER)/.test(name))
    )
    const result = spawnSync(BIN_PAIR, args, {
      encoding: "utf8",
      env: {
        ...env,
        GOKAPI_ENV_FILE: path.join(temp, "absent.env"),
        GOKAPI_API_URL: mockUrl,
        GOKAPI_PUBLIC_URL: `${PUBLIC_URL}/`,
        RELAY_DOMAIN: RELAY,
        RELAY_KV_NAMESPACE_ID: NAMESPACE,
        GOKAPI_ADMIN_API_KEY: ADMIN,
        WRANGLER: wrangler,
        FAKE_KV_URL: `${mockUrl}/client/v4`,
        PAIR_STATE_FILE: stateFile,
      },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }

  test("both write the same formats and see each other's devices", async () => {
    const cliLink = binPair("add", "cli-phone")
      .split("\n")
      .find((line) => line.includes("/pair#"))
    const cliState = readFileSync(stateFile, "utf8")
    const cliMock = await mock()
    const cliKeyId = state().devices[0].gokapiKeyId
    const cli = assertFormats({
      link: cliLink,
      kvValue: Object.values(cliMock.kv)[0].value,
      stateText: cliState,
      name: "cli-phone",
      gokapiKey: cliMock.apiKeys[cliKeyId].Id,
      gokapiKeyId: cliKeyId,
    })

    const web = await pair("web-phone")
    assert.equal(web.status, 201, JSON.stringify(web.body))
    const webMock = await mock()
    const webKeyId = web.body.device.gokapiKeyId
    const webPayload = assertFormats({
      link: web.body.link,
      kvValue: webMock.kv[`device:${decodeLink(web.body.link).relayId}`].value,
      stateText: readFileSync(stateFile, "utf8"),
      name: "web-phone",
      gokapiKey: webMock.apiKeys[webKeyId].Id,
      gokapiKeyId: webKeyId,
    })
    assert.equal(statSync(stateFile).mode & 0o777, 0o600)
    // The web write kept bin/pair's row byte for byte.
    assert.ok(readFileSync(stateFile, "utf8").startsWith(cliState.slice(0, cliState.lastIndexOf("}\n  ]"))))
    assert.deepEqual(webMock.apiKeys[webKeyId].Permissions, cliMock.apiKeys[cliKeyId].Permissions)

    const listing = binPair("list")
    assert.match(listing, /web-phone/)
    assert.ok(listing.includes(webPayload.relayId))
    assert.deepEqual(
      (await call("GET", "/devices")).body.devices.map((d) => d.name),
      ["cli-phone", "web-phone"]
    )

    assert.equal((await unpair("cli-phone")).status, 200)
    binPair("remove", "web-phone")
    const { apiKeys, kv } = await mock()
    assert.deepEqual([apiKeys, kv], [{}, {}])
    assert.deepEqual(state().devices, [])
    assert.ok(!(`device:${cli.relayId}` in kv))
    assert.match(binPair("list"), /No paired devices/)
  })
})
