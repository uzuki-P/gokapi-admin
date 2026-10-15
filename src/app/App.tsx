import * as React from "react"

import { M3eProvider } from "@/components/m3e/m3e-provider"
import { Toaster } from "@/components/m3e/toast"
import { TooltipProvider } from "@/components/m3e/tooltip"
import { GokapiClient } from "@/lib/gokapi"

import { FilesScreen } from "./FilesScreen"
import { SessionProvider, useStoredKey } from "./session"
import { SignInScreen } from "./SignInScreen"

export function App() {
  const [key, setKey] = useStoredKey()
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
              <FilesScreen />
            </SessionProvider>
          ) : (
            <SignInScreen onSignIn={setKey} />
          )}
        </Toaster>
      </TooltipProvider>
    </M3eProvider>
  )
}
