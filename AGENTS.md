# AGENTS.md

Guidance for coding agents and contributors working in this repository.

## What this project is

A Material 3 Expressive (shadcn-m3e) web UI for a self-hosted Gokapi v2.2.4.
It talks to Gokapi's REST API only, and Gokapi's own `/admin` page must keep
working without this app. README.md covers the architecture and setup.

## Commands

Use the justfile. `just check` must pass before a change is finished.

## Testing

- Do UI work against the mock (`node scripts/mock-gokapi.mjs 53899` with
  `GOKAPI_URL`). Don't upload, edit, or delete files on a real Gokapi
  instance to test.
- Read-only calls against a real Gokapi are fine when needed. Never print or
  commit an API key.
- `just install`, `just update`, `just uninstall`, and `just route` change
  the host's systemd user services and tailnet routes. Run them only when the
  maintainer asks.

## Conventions

- Keep API calls in `src/lib/gokapi.ts`. Header names and values follow the
  Gokapi OpenAPI spec (served by Gokapi at `/apidocumentation/openapi.json`)
  and match `gokapi-android`'s `GokapiClient.kt`.
- Use the m3e components and semantic color roles. No hardcoded hex colors
  except the theme seed in `src/app/App.tsx` and the QR code tile.
- Run `just icons` after adding an icon name. Names built at runtime need a
  `// @icons ...` comment.
- `server.mjs` has no dependencies and must stay on loopback.

## Devices

`devices.mjs` (served by `server.mjs` at `/devices`) is the web version of
the `bin/pair` script in the Gokapi deployment and must stay
format-compatible with it. That covers the KV value, the
`secrets/pairs.json` rows (jq's pretty print, atomic, 0600), and the pairing
link that gokapi-android's `Pairing.kt` parses.

- Gokapi key calls use the caller's `apikey`, never a stored key, and KV is
  touched only after Gokapi has accepted one of them.
- Never log or store a pairing link, relay secret, API key, or the
  Cloudflare token.
- Test with `just test` against the mock and its fake KV. Don't pair or
  unpair against a real Gokapi or Cloudflare account without the
  maintainer's go-ahead.
