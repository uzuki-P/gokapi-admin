# AGENTS.md

## What this project is

A Material 3 Expressive (shadcn-m3e) web UI for the private Gokapi v2.2.4 in
`~/dotconfig/_home/docker/files`. It talks to Gokapi's REST API only. Gokapi's
own `/admin` page must keep working without this app. README.md covers the
architecture and setup.

## Commands

Use the justfile. `just check` must pass before finishing a change.

## Testing

- Use the mock (`node scripts/mock-gokapi.mjs 53899` with `GOKAPI_URL`) for UI
  work. Do not upload, edit, or delete files on the real Gokapi to test.
- Read-only calls against the real Gokapi are fine when needed. Never print
  or commit an API key.
- `just install`, `just update`, `just uninstall`, and `just route` change
  the user's services and tailnet routes. Run them only when asked.

## Conventions

- Keep API calls in `src/lib/gokapi.ts`. Header names and values follow the
  Gokapi OpenAPI spec at `http://127.0.0.1:53842/apidocumentation/openapi.json`
  and match `gokapi-android`'s `GokapiClient.kt`.
- Use the m3e components and semantic color roles. No hardcoded hex colors
  except the theme seed in `src/app/App.tsx` and the QR code tile.
- Run `just icons` after adding an icon name. Names built at runtime need a
  `// @icons ...` comment.
- `server.mjs` has no dependencies and must stay on loopback.
