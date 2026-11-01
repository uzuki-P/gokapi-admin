import * as React from "react"

import { Button } from "@/components/m3e/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/m3e/dialog"
import { Icon } from "@/components/m3e/icon"
import { TextField } from "@/components/m3e/text-field"
import { toast } from "@/components/m3e/toast"
import { ApiError, DEVICE_NAME, type PairResult } from "@/lib/gokapi"

import { QrCode } from "./QrDialog"
import { useSession } from "./session"

// Two steps in one dialog: the device name, then the pairing link as a QR
// code. The link lives only in this component's state and is dropped once the
// dialog has closed; the server keeps no copy either.
export function PairDialog({
  open,
  taken,
  onClose,
  onPaired,
  onNoApiMod,
}: {
  open: boolean
  taken: string[]
  onClose: () => void
  onPaired: () => void
  onNoApiMod: () => void
}) {
  const [result, setResult] = React.useState<PairResult | null>(null)
  // While the server pairs, the dialog can't close: the link it returns is
  // the only copy.
  const [busy, setBusy] = React.useState(false)
  // A fresh form, and no link, once the close animation has finished.
  const [round, setRound] = React.useState(0)
  const reset = (isOpen: boolean) => {
    if (isOpen) return
    setResult(null)
    setRound((value) => value + 1)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !busy && onClose()}
      onOpenChangeComplete={reset}
      disablePointerDismissal
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        {result ? (
          <PairingLink result={result} onDone={onClose} />
        ) : (
          <NameForm
            key={round}
            taken={taken}
            busy={busy}
            setBusy={setBusy}
            onCancel={onClose}
            onPaired={(paired) => {
              setResult(paired)
              onPaired()
            }}
            onNoApiMod={() => {
              onClose()
              onNoApiMod()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NameForm({
  taken,
  busy,
  setBusy,
  onCancel,
  onPaired,
  onNoApiMod,
}: {
  taken: string[]
  busy: boolean
  setBusy: (busy: boolean) => void
  onCancel: () => void
  onPaired: (result: PairResult) => void
  onNoApiMod: () => void
}) {
  const { client } = useSession()
  const [name, setName] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const value = name.trim()
  const invalid =
    value && !DEVICE_NAME.test(value)
      ? "Lowercase letters, digits, and dashes, up to 32, starting with a letter or digit."
      : taken.includes(value)
        ? `${value} is already paired. Unpair it first.`
        : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!value || invalid) return
    setBusy(true)
    setError(null)
    try {
      onPaired(await client.pairDevice(value))
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "no-api-mod") return onNoApiMod()
      setError(caught instanceof Error ? caught.message : "Pairing failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>Pair a device</DialogTitle>
        <DialogDescription>
          Creates a Gokapi API key and a relay credential for one phone running gokapi-android.
        </DialogDescription>
      </DialogHeader>
      <TextField
        label="Device name"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="pixel-9"
        value={name}
        onChange={(event) => {
          setName(event.target.value.toLowerCase())
          setError(null)
        }}
        leadingIcon={<Icon name="mobile" />}
        error={Boolean(invalid || error)}
        errorText={invalid ?? error}
        supportingText="Lowercase letters, digits, and dashes, such as pixel-9."
        disabled={busy}
        autoFocus
      />
      <DialogFooter>
        <Button type="button" variant="text" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !value || Boolean(invalid)}>
          {busy ? "Pairing" : "Pair"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function PairingLink({ result, onDone }: { result: PairResult; onDone: () => void }) {
  const name = result.device.name
  async function copy() {
    try {
      await navigator.clipboard.writeText(result.link)
      toast.add({ title: "Pairing link copied", description: `Paste it only on ${name}.`, type: "success", timeout: 3000 })
    } catch {
      toast.add({ title: "Could not copy the pairing link", type: "error" })
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Scan on {name}</DialogTitle>
        <DialogDescription>
          Open the camera or gokapi-android on {name} and scan the code, or copy the link and open it there.
        </DialogDescription>
      </DialogHeader>
      <QrCode value={result.link} label={`Pairing QR code for ${name}`} className="size-64 sm:size-72" />
      <div role="note" className="flex gap-3 rounded-2xl bg-error-container px-4 py-3 text-on-error-container">
        <Icon name="warning" className="mt-0.5 shrink-0" />
        <p className="text-body-medium">
          This link is a credential: it holds the API key and the relay secret. Open it on {name} only, and don't
          paste it into chats. Nothing secret was saved, so if the link is lost, unpair {name} and pair it again.
        </p>
      </div>
      <DialogFooter>
        <Button variant="text" onClick={() => void copy()}>
          <Icon name="content_copy" data-icon="inline-start" />
          Copy link
        </Button>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </>
  )
}
