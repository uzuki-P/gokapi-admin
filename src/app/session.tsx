import * as React from "react"

import { GokapiClient } from "@/lib/gokapi"

// The key stays in this browser's localStorage. The app is reachable only on
// the tailnet, and Gokapi keys can be deleted from its API menu at any time.
const STORAGE_KEY = "gokapi-admin.api-key"

type Session = {
  client: GokapiClient
  signOut: () => void
}

const SessionContext = React.createContext<Session | undefined>(undefined)

function readKey() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function useStoredKey() {
  const [key, setKey] = React.useState(readKey)
  const save = React.useCallback((value: string | null) => {
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Storage blocked: the key lasts until the tab closes.
    }
    setKey(value)
  }, [])
  return [key, save] as const
}

export function SessionProvider({
  client,
  signOut,
  children,
}: Session & { children: React.ReactNode }) {
  const value = React.useMemo(() => ({ client, signOut }), [client, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const session = React.useContext(SessionContext)
  if (!session) throw new Error("useSession needs a SessionProvider")
  return session
}
