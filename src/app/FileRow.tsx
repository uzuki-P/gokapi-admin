import * as React from "react"

import { Badge } from "@/components/m3e/badge"
import { Button } from "@/components/m3e/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/m3e/dropdown-menu"
import { Icon } from "@/components/m3e/icon"
import { LoadingIndicator } from "@/components/m3e/loading-indicator"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/m3e/item"
import { toast } from "@/components/m3e/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/m3e/tooltip"
import type { GokapiFile } from "@/lib/gokapi"
import { downloadsText, expiryText, fileIcon } from "@/lib/format"

import { useSession } from "./session"
import { useThumbnail } from "./useThumbnail"

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: `${what} copied`, type: "success", timeout: 2000 })
  } catch {
    toast.add({ title: `Could not copy the ${what.toLowerCase()}`, type: "error" })
  }
}

// Saves the file through the API, so it skips the password prompt and does
// not use up a download. End-to-end encrypted files would arrive as
// ciphertext, so the row offers no direct download for them.
function useDirectDownload(file: GokapiFile) {
  const { client } = useSession()
  const [busy, setBusy] = React.useState(false)
  const start = React.useCallback(async () => {
    setBusy(true)
    try {
      const blob = await client.download(file.Id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = file.Name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (caught) {
      toast.add({ title: "Could not download", description: caught instanceof Error ? caught.message : undefined, type: "error" })
    } finally {
      setBusy(false)
    }
  }, [client, file.Id, file.Name])
  return { busy, start }
}

export function FileRow({
  file,
  onEdit,
  onQr,
  onDelete,
}: {
  file: GokapiFile
  onEdit: () => void
  onQr: () => void
  onDelete: () => void
}) {
  const hotlink = file.UrlHotlink || null
  const thumbnail = useThumbnail(file)
  const download = useDirectDownload(file)
  return (
    <Item variant="segmented" className="bg-surface-container-low">
      <ItemMedia variant="image" className="bg-secondary-container text-on-secondary-container">
        {thumbnail ? (
          <img src={thumbnail} alt="" decoding="async" />
        ) : (
          <Icon name={fileIcon(file.ContentType)} />
        )}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full">
          <a
            href={file.UrlDownload}
            target="_blank"
            rel="noreferrer"
            className="truncate hover:underline focus-visible:underline"
          >
            {file.Name}
          </a>
          {file.IsPasswordProtected && (
            <Badge variant="outline">
              <Icon name="lock" data-icon="inline-start" />
              Password
            </Badge>
          )}
        </ItemTitle>
        <ItemDescription className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span>{file.Size}</span>
          <span>{expiryText(file)}</span>
          <span>{downloadsText(file)}</span>
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {!file.IsEndToEndEncrypted && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="tonal"
                  size="icon"
                  aria-label={`Download ${file.Name}`}
                  disabled={download.busy}
                  onClick={download.start}
                >
                  {download.busy ? <LoadingIndicator size={24} aria-label="Downloading" /> : <Icon name="download" />}
                </Button>
              }
            />
            <TooltipContent>Download</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="tonal" size="icon" aria-label="Copy link" onClick={() => copy(file.UrlDownload, "Link")}>
                <Icon name="link" />
              </Button>
            }
          />
          <TooltipContent>Copy link</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label={`More actions for ${file.Name}`}>
                <Icon name="more_vert" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              {hotlink && (
                <DropdownMenuItem onClick={() => copy(hotlink, "Hotlink")}>
                  <Icon name="image" size={20} />
                  Copy hotlink
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onQr}>
                <Icon name="qr_code_2" size={20} />
                Show QR code
              </DropdownMenuItem>
              <DropdownMenuItem render={<a href={file.UrlDownload} target="_blank" rel="noreferrer" />}>
                <Icon name="open_in_new" size={20} />
                Open download page
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Icon name="edit" size={20} />
                Edit
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Icon name="delete" size={20} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  )
}
