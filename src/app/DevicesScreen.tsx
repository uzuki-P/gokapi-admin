import * as React from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/m3e/alert-dialog"
import { AppBar, useScrolled } from "@/components/m3e/app-bar"
import { Button } from "@/components/m3e/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/m3e/empty"
import { Icon } from "@/components/m3e/icon"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/m3e/item"
import { LoadingIndicator } from "@/components/m3e/loading-indicator"
import { toast } from "@/components/m3e/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/m3e/tooltip"
import { ApiError, type PairedDevice } from "@/lib/gokapi"

import { PairDialog } from "./PairDialog"
import { useSession } from "./session"
import { ThemeMenu } from "./ThemeMenu"

type Load =
  | { kind: "loading" }
  | { kind: "ready"; devices: PairedDevice[] }
  | { kind: "no-api-mod" }
  | { kind: "error"; message: string }

function useDevices() {
  const { client, signOut } = useSession()
  const [load, setLoad] = React.useState<Load>({ kind: "loading" })
  const [refreshing, setRefreshing] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      setLoad({ kind: "ready", devices: await client.devices() })
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "no-api-mod") setLoad({ kind: "no-api-mod" })
      else if (caught instanceof ApiError && caught.status === 401) {
        toast.add({ title: "Signed out", description: "Gokapi no longer accepts this API key.", type: "error" })
        signOut()
      } else setLoad({ kind: "error", message: caught instanceof Error ? caught.message : "Could not load devices." })
    } finally {
      setRefreshing(false)
    }
  }, [client, signOut])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  return { load, setLoad, refreshing, refresh }
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

function pairedText(created: string) {
  const date = new Date(created)
  return Number.isNaN(date.getTime()) ? created : `Paired ${dateFormat.format(date)}`
}

export function DevicesScreen({ onBack }: { onBack: () => void }) {
  const { client } = useSession()
  const { load, setLoad, refreshing, refresh } = useDevices()
  const [pairing, setPairing] = React.useState(false)
  const [confirming, setConfirming] = React.useState<PairedDevice | null>(null)
  const [removing, setRemoving] = React.useState<string | null>(null)
  const scrolled = useScrolled()
  const devices = load.kind === "ready" ? load.devices : []

  async function unpair(device: PairedDevice) {
    setConfirming(null)
    setRemoving(device.name)
    try {
      const result = await client.unpairDevice(device.name)
      toast.add({ title: result.message, description: result.note, type: "success", timeout: 6000 })
      for (const warning of result.warnings) toast.add({ title: "Check Gokapi", description: warning, type: "error" })
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "no-api-mod") setLoad({ kind: "no-api-mod" })
      else toast.add({ title: `Could not unpair ${device.name}`, description: caught instanceof Error ? caught.message : undefined, type: "error" })
    } finally {
      setRemoving(null)
      void refresh()
    }
  }

  return (
    <div className="min-h-dvh bg-surface">
      <AppBar
        className="sticky top-0 z-20"
        title="Devices"
        scrolled={scrolled}
        leading={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="Back to files" onClick={onBack}>
                  <Icon name="arrow_back" />
                </Button>
              }
            />
            <TooltipContent>Back to files</TooltipContent>
          </Tooltip>
        }
        trailing={
          <>
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
          </>
        }
      />

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-2 pb-16 sm:px-6">
        <section aria-labelledby="devices-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-xl">
              <h2 id="devices-heading" className="text-headline-small">
                Paired devices
              </h2>
              <p className="text-body-medium text-on-surface-variant">
                Phones running gokapi-android that can reach Files through the relay when the tailnet is not
                available. Each one has its own Gokapi key and relay credential.
              </p>
            </div>
            {load.kind === "ready" && (
              <Button size="md" onClick={() => setPairing(true)}>
                <Icon name="add" data-icon="inline-start" />
                Pair device
              </Button>
            )}
          </div>

          {load.kind === "loading" && (
            <div className="flex justify-center py-16">
              <LoadingIndicator aria-label="Loading devices" />
            </div>
          )}

          {load.kind === "error" && (
            <div role="alert" className="flex items-center gap-3 rounded-2xl bg-error-container px-4 py-3 text-on-error-container">
              <Icon name="error" />
              <span className="flex-1 text-body-medium">{load.message}</span>
              <Button variant="text" size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          )}

          {load.kind === "no-api-mod" && (
            <Empty className="rounded-3xl bg-surface-container-low py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon name="key_off" />
                </EmptyMedia>
                <EmptyTitle>This key can't manage devices</EmptyTitle>
                <EmptyDescription>
                  Pairing creates a Gokapi API key for each device, so it needs a key with the API management
                  permission (Manage API keys). In Gokapi's admin page, open API and grant it to this key, or
                  create a key with it, sign out, and sign in with that key.
                </EmptyDescription>
              </EmptyHeader>
              <Button variant="tonal" onClick={() => void refresh()}>
                Check again
              </Button>
            </Empty>
          )}

          {load.kind === "ready" &&
            (devices.length > 0 ? (
              <ItemGroup className="gap-0.5">
                {devices.map((device) => (
                  <Item key={device.name} variant="segmented" className="bg-surface-container-low">
                    <ItemMedia variant="image" className="bg-secondary-container text-on-secondary-container">
                      <Icon name="mobile" />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="w-full truncate">{device.name}</ItemTitle>
                      <ItemDescription className="flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>{pairedText(device.created)}</span>
                        <span className="font-mono break-all">Relay ID {device.relayId}</span>
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="tonal"
                              size="icon"
                              aria-label={`Unpair ${device.name}`}
                              disabled={removing !== null}
                              onClick={() => setConfirming(device)}
                            >
                              {removing === device.name ? (
                                <LoadingIndicator size={24} aria-label="Unpairing" />
                              ) : (
                                <Icon name="link_off" />
                              )}
                            </Button>
                          }
                        />
                        <TooltipContent>Unpair</TooltipContent>
                      </Tooltip>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            ) : (
              <Empty className="rounded-3xl bg-surface-container-low py-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Icon name="phonelink_off" />
                  </EmptyMedia>
                  <EmptyTitle>No paired devices</EmptyTitle>
                  <EmptyDescription>Pair a phone to use gokapi-android away from the tailnet.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ))}
        </section>
      </main>

      <PairDialog
        open={pairing}
        taken={devices.map((device) => device.name)}
        onClose={() => setPairing(false)}
        onPaired={() => void refresh()}
        onNoApiMod={() => setLoad({ kind: "no-api-mod" })}
      />

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpair {confirming?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes its relay credential and its Gokapi API key. The app on {confirming?.name} stops working
              until you pair it again. The relay may accept the old credential for up to a minute.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => confirming && void unpair(confirming)}>
              Unpair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
