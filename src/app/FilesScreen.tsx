import * as React from "react"

import { AppBar, useScrolled } from "@/components/m3e/app-bar"
import { Button } from "@/components/m3e/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/m3e/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/m3e/empty"
import { Icon } from "@/components/m3e/icon"
import { ItemGroup } from "@/components/m3e/item"
import { LoadingIndicator } from "@/components/m3e/loading-indicator"
import { TextField } from "@/components/m3e/text-field"
import { toast } from "@/components/m3e/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/m3e/tooltip"
import { ApiError, type FileChanges, type GokapiFile } from "@/lib/gokapi"

import { EditDialog } from "./EditDialog"
import { FileRow } from "./FileRow"
import { QrDialog } from "./QrDialog"
import { useSession } from "./session"
import { ThemeMenu } from "./ThemeMenu"
import { UploadPanel } from "./UploadPanel"
import { useUploads } from "./useUploads"

// Gokapi waits this long before deleting, so the toast can offer Undo.
const DELETE_DELAY_SECONDS = 10
const REFRESH_MS = 30_000

function useFiles() {
  const { client, signOut } = useSession()
  const [files, setFiles] = React.useState<GokapiFile[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await client.list()
      setFiles(list.filter((file) => !file.IsPendingDeletion))
      setError(null)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        toast.add({ title: "Signed out", description: "Gokapi no longer accepts this API key.", type: "error" })
        signOut()
        return
      }
      setError(caught instanceof Error ? caught.message : "Could not load files.")
    } finally {
      setRefreshing(false)
    }
  }, [client, signOut])

  React.useEffect(() => {
    void refresh()
    const onFocus = () => document.visibilityState === "visible" && void refresh()
    const timer = window.setInterval(onFocus, REFRESH_MS)
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [refresh])

  return { files, setFiles, error, refreshing, refresh }
}

// Counts nested dragenter/dragleave pairs so child elements do not flicker
// the overlay.
function useWindowDrop() {
  const [over, setOver] = React.useState(false)
  React.useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth++
      setOver(true)
    }
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const overHandler = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setOver(false)
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length) window.dispatchEvent(new CustomEvent("gokapi-admin:drop", { detail: files }))
    }
    window.addEventListener("dragenter", enter)
    window.addEventListener("dragleave", leave)
    window.addEventListener("dragover", overHandler)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragenter", enter)
      window.removeEventListener("dragleave", leave)
      window.removeEventListener("dragover", overHandler)
      window.removeEventListener("drop", drop)
    }
  }, [])
  return over
}

export function FilesScreen({ onOpenDevices }: { onOpenDevices: () => void }) {
  const { client, signOut } = useSession()
  const { files, setFiles, error, refreshing, refresh } = useFiles()
  const [query, setQuery] = React.useState("")
  const [editing, setEditing] = React.useState<GokapiFile | null>(null)
  const [qrFile, setQrFile] = React.useState<GokapiFile | null>(null)
  const scrolled = useScrolled()
  const dragging = useWindowDrop()

  const onUploaded = React.useCallback(
    (file: GokapiFile) => {
      setFiles((current) => [file, ...(current ?? []).filter((f) => f.Id !== file.Id)])
      toast.add({ title: "Uploaded", description: file.Name, type: "success", timeout: 3000 })
    },
    [setFiles]
  )
  const uploads = useUploads(onUploaded)

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (files ?? [])
      .filter((file) => !needle || file.Name.toLowerCase().includes(needle) || file.Id.toLowerCase() === needle)
      .sort((a, b) => b.UploadDate - a.UploadDate)
  }, [files, query])

  async function remove(file: GokapiFile) {
    try {
      await client.remove(file.Id, DELETE_DELAY_SECONDS)
    } catch (caught) {
      toast.add({ title: "Could not delete", description: caught instanceof Error ? caught.message : undefined, type: "error" })
      return
    }
    setFiles((current) => (current ?? []).filter((f) => f.Id !== file.Id))
    toast.add({
      title: "File deleted",
      description: file.Name,
      timeout: (DELETE_DELAY_SECONDS - 1) * 1000,
      actionProps: {
        children: "Undo",
        onClick: async () => {
          try {
            await client.restore(file.Id)
            await refresh()
          } catch (caught) {
            toast.add({ title: "Could not restore", description: caught instanceof Error ? caught.message : undefined, type: "error" })
          }
        },
      },
    })
  }

  async function save(file: GokapiFile, changes: FileChanges) {
    try {
      const updated = await client.modify(file.Id, changes)
      setFiles((current) => (current ?? []).map((f) => (f.Id === file.Id ? { ...f, ...updated } : f)))
      setEditing(null)
      toast.add({ title: "Changes saved", type: "success", timeout: 2000 })
    } catch (caught) {
      toast.add({ title: "Could not save", description: caught instanceof Error ? caught.message : undefined, type: "error" })
    }
  }

  return (
    <div className="min-h-dvh bg-surface">
      <AppBar
        className="sticky top-0 z-20"
        title="Files"
        scrolled={scrolled}
        leading={
          <div className="ml-1 flex size-10 items-center justify-center rounded-xl bg-primary text-on-primary">
            <Icon name="cloud_upload" size={22} />
          </div>
        }
        trailing={
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon" aria-label="Devices" onClick={onOpenDevices}>
                    <Icon name="devices" />
                  </Button>
                }
              />
              <TooltipContent>Paired devices</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void refresh()} disabled={refreshing}>
                    <Icon name="refresh" className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />
                  </Button>
                }
              />
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
            <ThemeMenu />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" aria-label="Account">
                    <Icon name="account_circle" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={signOut}>
                    <Icon name="logout" size={20} />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 pt-2 pb-16 sm:px-6">
        <UploadPanel
          jobs={uploads.jobs}
          onAdd={uploads.add}
          onCancel={uploads.cancel}
          onDismiss={uploads.dismiss}
          onClearFinished={uploads.clearFinished}
        />

        <section aria-labelledby="files-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="files-heading" className="text-headline-small">
                Shared files
              </h2>
              {files && (
                <p className="text-body-medium text-on-surface-variant">
                  {files.length === 1 ? "1 file" : `${files.length} files`}
                </p>
              )}
            </div>
            <TextField
              variant="filled"
              label="Search by name"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              leadingIcon={<Icon name="search" />}
              containerClassName="w-full sm:w-72"
            />
          </div>

          {error && (
            <div role="alert" className="flex items-center gap-3 rounded-2xl bg-error-container px-4 py-3 text-on-error-container">
              <Icon name="error" />
              <span className="flex-1 text-body-medium">{error}</span>
              <Button variant="text" size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          )}

          {files === null && !error ? (
            <div className="flex justify-center py-16">
              <LoadingIndicator aria-label="Loading files" />
            </div>
          ) : visible.length > 0 ? (
            <ItemGroup className="gap-0.5">
              {visible.map((file) => (
                <FileRow
                  key={file.Id}
                  file={file}
                  onEdit={() => setEditing(file)}
                  onQr={() => setQrFile(file)}
                  onDelete={() => void remove(file)}
                />
              ))}
            </ItemGroup>
          ) : files !== null ? (
            <Empty className="rounded-3xl bg-surface-container-low py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon name={query ? "search_off" : "inbox"} />
                </EmptyMedia>
                <EmptyTitle>{query ? "No matching files" : "Nothing shared yet"}</EmptyTitle>
                <EmptyDescription>
                  {query ? "Try another name." : "Uploaded files appear here until they expire."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
        </section>
      </main>

      <EditDialog file={editing} onClose={() => setEditing(null)} onSave={save} />
      <QrDialog url={qrFile?.UrlDownload ?? null} name={qrFile?.Name ?? ""} onClose={() => setQrFile(null)} />

      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-4xl border-4 border-dashed border-primary bg-primary-container/80 text-on-primary-container backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-3">
            <Icon name="upload" size={48} />
            <span className="text-headline-small">Drop to upload</span>
          </div>
        </div>
      )}
    </div>
  )
}
