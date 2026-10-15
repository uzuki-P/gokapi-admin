# gokapi-admin

A Material 3 Expressive web UI for the private Gokapi in
`~/dotconfig/_home/docker/files`. It replaces Gokapi's own admin page for
everyday use: upload with drag and drop, list, search, copy links, QR codes,
edit downloads, expiry, and password, and delete with undo.

It is a separate app. Gokapi and its own `/admin` page keep working whether
or not this app is installed or running.

## How it works

- React 19, Vite, Tailwind CSS v4, and shadcn-m3e components in
  `src/components/m3e`.
- The browser calls Gokapi's REST API (`/api/...`) with an API key in the
  `apikey` header, the same way `gokapi-android` and `bin/share` do.
- Gokapi sends no CORS headers, so `/api` must be on the same origin.
  `server.mjs` serves `dist/` and forwards `/api/*` to Gokapi at
  `127.0.0.1:53842`. In development, Vite's proxy does the same.
- `server.mjs` listens on `127.0.0.1:53844` only. `just route` publishes it
  on the tailnet as `https://files-ui.<tailnet base domain>` through the
  existing dev-router. Nothing is exposed to the public internet.
- Thumbnails come from `/api/files/download/{id}` with `increaseCounter:
  false`, so previews never use up a download. Only raster images up to
  8 MB get one.
- Delete waits 10 seconds on the Gokapi side (`delay` header), and the toast
  offers Undo through `/api/files/restore`.

## API key

Create a key in Gokapi's admin page under API. Give it:

| Permission | Used for |
| --- | --- |
| View files | Listing, and checking the key at sign-in |
| Upload | Uploads and the upload size limits |
| Edit | The edit dialog |
| Delete | Delete and undo |
| Download | Image thumbnails (optional) |

Paste it on the sign-in screen. The key stays in this browser's
localStorage until you sign out. Delete the key in Gokapi to revoke it.

## Setup

```bash
just install-deps
just install        # build, install, and start the user service on 53844
just route          # publish https://files-ui.<tailnet base domain>
```

`just update` rebuilds and restarts the service. `just status` and
`just logs` inspect it. `just uninstall` removes the service. Gokapi itself
is untouched by every recipe here.

## Develop

```bash
just dev            # http://127.0.0.1:5181, /api proxied to the local Gokapi
just check          # lint, icon bundle check, type check, build
just icons          # after using a new Material Symbols icon
```

Set `GOKAPI_URL` to point `just dev` or `server.mjs` at another Gokapi. For
UI work without touching real files, run the mock:

```bash
node scripts/mock-gokapi.mjs 53899
GOKAPI_URL=http://127.0.0.1:53899 just dev
```

The mock accepts any API key except `bad`.

## Limits

- Download passwords must be ASCII, because Gokapi takes them in an HTTP
  header. File names can use any characters.
- Users, file requests, logs, and API key management stay in Gokapi's own
  admin page.
