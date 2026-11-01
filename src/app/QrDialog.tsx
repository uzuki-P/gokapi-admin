import * as React from "react"
import { encode } from "uqr"

import { Button } from "@/components/m3e/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/m3e/dialog"

export function QrDialog({
  url,
  name,
  onClose,
}: {
  url: string | null
  name: string
  onClose: () => void
}) {
  return (
    <Dialog open={url !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Scan to download</DialogTitle>
          <DialogDescription className="break-all">{name}</DialogDescription>
        </DialogHeader>
        {url && <QrCode value={url} label="QR code for the download link" />}
        <DialogFooter>
          <Button variant="text" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Dark modules on a white tile in both themes: phone cameras read dark on
// light most reliably.
export function QrCode({
  value,
  label,
  className = "size-56",
}: {
  value: string
  label: string
  className?: string
}) {
  const path = React.useMemo(() => {
    const { data, size } = encode(value, { ecc: "M", border: 0 })
    let d = ""
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) if (data[y][x]) d += `M${x} ${y}h1v1h-1z`
    return { d, size }
  }, [value])
  return (
    <div className="mx-auto rounded-2xl bg-white p-4">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${path.size} ${path.size}`}
        className={className}
        shapeRendering="crispEdges"
      >
        <path d={path.d} fill="#000" />
      </svg>
    </div>
  )
}
