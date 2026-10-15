import * as React from "react"

import { Button } from "@/components/m3e/button"
import { Card, CardContent } from "@/components/m3e/card"
import { Icon } from "@/components/m3e/icon"
import { TextField } from "@/components/m3e/text-field"
import { ApiError, GokapiClient } from "@/lib/gokapi"

import { ThemeMenu } from "./ThemeMenu"

export function SignInScreen({ onSignIn }: { onSignIn: (key: string) => void }) {
  const [key, setKey] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = key.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      await new GokapiClient(value).list()
      onSignIn(value)
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 401
          ? "Gokapi rejected this key, or it lacks the View files permission."
          : caught instanceof Error
            ? caught.message
            : "Sign-in failed."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative grid min-h-dvh place-items-center bg-surface-container p-4">
      <div className="absolute top-3 right-3">
        <ThemeMenu />
      </div>
      <Card variant="elevated" className="w-full max-w-md rounded-3xl">
        <CardContent className="flex flex-col gap-6 p-8">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container">
            <Icon name="cloud_upload" size={32} />
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-headline-medium">Sign in to Files</h1>
            <p className="text-body-medium text-on-surface-variant">
              Paste a Gokapi API key. Create one in Gokapi's admin page under
              API, with View files, Upload, Edit, and Delete.
            </p>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <TextField
              label="API key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              leadingIcon={<Icon name="key" />}
              error={error !== null}
              errorText={error}
              supportingText="Kept in this browser until you sign out."
              autoFocus
            />
            <Button type="submit" size="md" disabled={busy || !key.trim()}>
              {busy ? "Checking key" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
