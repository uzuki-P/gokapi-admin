import * as React from "react"

import { Button } from "@/components/m3e/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/m3e/dialog"
import { Switch } from "@/components/m3e/switch"
import { TextField } from "@/components/m3e/text-field"
import { ToggleGroup, ToggleGroupItem } from "@/components/m3e/toggle-group"
import type { FileChanges, GokapiFile } from "@/lib/gokapi"
import { fromLocalInput, toLocalInput } from "@/lib/format"

type PasswordChoice = "keep" | "none" | "set"
const ASCII = /^[\x20-\x7e]*$/

export function EditDialog({
  file,
  onClose,
  onSave,
}: {
  file: GokapiFile | null
  onClose: () => void
  onSave: (file: GokapiFile, changes: FileChanges) => Promise<void>
}) {
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        {file && <EditForm key={file.Id} file={file} onClose={onClose} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  )
}

function EditForm({
  file,
  onClose,
  onSave,
}: {
  file: GokapiFile
  onClose: () => void
  onSave: (file: GokapiFile, changes: FileChanges) => Promise<void>
}) {
  const weekAhead = Math.floor(Date.now() / 1000) + 7 * 86400
  const [unlimitedDownloads, setUnlimitedDownloads] = React.useState(file.UnlimitedDownloads)
  const [downloads, setDownloads] = React.useState(String(file.UnlimitedDownloads ? 1 : file.DownloadsRemaining))
  const [neverExpires, setNeverExpires] = React.useState(file.UnlimitedTime)
  const [expiry, setExpiry] = React.useState(toLocalInput(file.UnlimitedTime ? weekAhead : file.ExpireAt))
  const [passwordChoice, setPasswordChoice] = React.useState<PasswordChoice>(
    file.IsPasswordProtected ? "keep" : "none"
  )
  const [password, setPassword] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const downloadsValue = Number(downloads)
  const downloadsValid = unlimitedDownloads || (Number.isInteger(downloadsValue) && downloadsValue > 0)
  const expiryValue = fromLocalInput(expiry)
  const expiryValid = neverExpires || (Number.isFinite(expiryValue) && expiryValue > Date.now() / 1000)
  const passwordValid = passwordChoice !== "set" || (password.length > 0 && ASCII.test(password))
  const valid = downloadsValid && expiryValid && passwordValid

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    setSaving(true)
    try {
      await onSave(file, {
        allowedDownloads: unlimitedDownloads ? 0 : downloadsValue,
        expiryTimestamp: neverExpires ? 0 : expiryValue,
        password: passwordChoice === "keep" ? null : passwordChoice === "set" ? password : "",
      })
    } finally {
      setSaving(false)
    }
  }

  const choices: { value: PasswordChoice; label: string }[] = [
    ...(file.IsPasswordProtected ? [{ value: "keep" as const, label: "Keep" }] : []),
    { value: "none", label: "No password" },
    { value: "set", label: file.IsPasswordProtected ? "Change" : "Set" },
  ]

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>Edit file</DialogTitle>
        <DialogDescription className="break-all">{file.Name}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-3">
          <SwitchRow label="Unlimited downloads" checked={unlimitedDownloads} onChange={setUnlimitedDownloads} />
          {!unlimitedDownloads && (
            <TextField
              label="Downloads left"
              type="number"
              inputMode="numeric"
              min={1}
              value={downloads}
              onChange={(event) => setDownloads(event.target.value)}
              error={!downloadsValid}
              errorText="Enter a whole number above 0."
            />
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <SwitchRow label="Never expires" checked={neverExpires} onChange={setNeverExpires} />
          {!neverExpires && (
            <TextField
              label="Expires at"
              type="datetime-local"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
              error={!expiryValid}
              errorText="Pick a time in the future."
            />
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-label-large text-on-surface-variant">Download password</legend>
          <ToggleGroup
            spacing={0}
            className="w-full"
            value={[passwordChoice]}
            onValueChange={(next) => next[0] && setPasswordChoice(next[0] as PasswordChoice)}
          >
            {choices.map((choice) => (
              <ToggleGroupItem key={choice.value} value={choice.value}>
                {choice.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {passwordChoice === "set" && (
            <TextField
              label="New password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={password.length > 0 && !passwordValid}
              errorText="Use letters, digits, and ASCII symbols only."
              autoFocus
            />
          )}
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="text" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="text" disabled={!valid || saving}>
          {saving ? "Saving" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = React.useId()
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={id} className="text-body-large">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
