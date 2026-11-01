import * as React from "react"

import { M3eProvider } from "@/components/m3e/m3e-provider"
import { Toaster } from "@/components/m3e/toast"
import { TooltipProvider } from "@/components/m3e/tooltip"
import { GokapiClient } from "@/lib/gokapi"

import { DevicesScreen } from "./DevicesScreen"
import { FilesScreen } from "./FilesScreen"
import { SessionProvider, useStoredKey } from "./session"
import { SignInScreen } from "./SignInScreen"

type Screen = "files" | "devices"

const readScreen = (): Screen => (window.location.hash === "#devices" ? "devices" : "files")

// The screen lives in the URL hash, so reload and the back button keep it.
function useScreen() {
  const [screen, setScreen] = React.useState(readScreen)
  React.useEffect(() => {
    const sync = () => setScreen(readScreen())
    window.addEventListener("popstate", sync)
    window.addEventListener("hashchange", sync)
    return () => {
      window.removeEventListener("popstate", sync)
      window.removeEventListener("hashchange", sync)
    }
  }, [])
  const go = React.useCallback((next: Screen) => {
    const { pathname, search } = window.location
    window.history.pushState(null, "", next === "devices" ? "#devices" : pathname + search)
    setScreen(next)
    window.scrollTo(0, 0)
  }, [])
  return [screen, go] as const
}

export function App() {
  const [key, setKey] = useStoredKey()
  const [screen, go] = useScreen()
  const client = React.useMemo(() => (key ? new GokapiClient(key) : null), [key])
  const signOut = React.useCallback(() => setKey(null), [setKey])

  return (
    <M3eProvider
      colorMode={{ toggleKey: false }}
      theme={{
        defaultTheme: { source: { primary: "#006a6a" }, variant: "tonalSpot" },
        persist: false,
      }}
    >
      <TooltipProvider>
        <Toaster>
          {client ? (
            <SessionProvider client={client} signOut={signOut}>
              {screen === "devices" ? (
                <DevicesScreen onBack={() => go("files")} />
              ) : (
                <FilesScreen onOpenDevices={() => go("devices")} />
              )}
            </SessionProvider>
          ) : (
            <SignInScreen onSignIn={setKey} />
          )}
        </Toaster>
      </TooltipProvider>
    </M3eProvider>
  )
}
