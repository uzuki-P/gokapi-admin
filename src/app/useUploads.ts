import * as React from "react"

import { toast } from "@/components/m3e/toast"
import { ApiError, type GokapiFile, type UploadLimits, type UploadOptions } from "@/lib/gokapi"
import { formatBytes } from "@/lib/format"

import { useSession } from "./session"

export type UploadStatus = "queued" | "uploading" | "done" | "failed" | "cancelled"

export interface UploadJob {
  id: string
  file: File
  options: UploadOptions
  sent: number
  status: UploadStatus
  error?: string
  result?: GokapiFile
}

/**
 * Uploads files one at a time, in the order they were added. Each job keeps
 * the options chosen when it was queued.
 */
export function useUploads(onUploaded: (file: GokapiFile) => void) {
  const { client } = useSession()
  const [jobs, setJobs] = React.useState<UploadJob[]>([])
  const queue = React.useRef<UploadJob[]>([])
  const controllers = React.useRef(new Map<string, AbortController>())
  const running = React.useRef(false)
  const limits = React.useRef<UploadLimits | null>(null)
  const uploaded = React.useRef(onUploaded)
  React.useEffect(() => {
    uploaded.current = onUploaded
  })

  const update = React.useCallback((id: string, patch: Partial<UploadJob>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)))
  }, [])

  const run = React.useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      for (let job = queue.current.shift(); job; job = queue.current.shift()) {
        const controller = controllers.current.get(job.id)
        if (!controller || controller.signal.aborted) continue
        update(job.id, { status: "uploading" })
        try {
          limits.current ??= await client.limits()
          if (job.file.size > limits.current.maxFileBytes)
            throw new ApiError(413, `Files over ${formatBytes(limits.current.maxFileBytes)} are not allowed.`)
          const id = job.id
          const result = await client.upload(
            job.file,
            job.options,
            limits.current,
            (sent) => update(id, { sent }),
            controller.signal
          )
          update(job.id, { status: "done", sent: job.file.size, result })
          uploaded.current(result)
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            update(job.id, { status: "cancelled" })
          } else {
            const message = error instanceof Error ? error.message : "Upload failed."
            update(job.id, { status: "failed", error: message })
            toast.add({ title: `${job.file.name} failed`, description: message, type: "error" })
          }
        } finally {
          controllers.current.delete(job.id)
        }
      }
    } finally {
      running.current = false
    }
  }, [client, update])

  const add = React.useCallback(
    (files: File[], options: UploadOptions) => {
      const added = files.map((file) => {
        const job: UploadJob = {
          id: crypto.randomUUID(),
          file,
          options,
          sent: 0,
          status: "queued",
        }
        controllers.current.set(job.id, new AbortController())
        return job
      })
      queue.current.push(...added)
      setJobs((current) => [...added, ...current])
      void run()
    },
    [run]
  )

  const cancel = React.useCallback(
    (id: string) => {
      controllers.current.get(id)?.abort()
      setJobs((current) =>
        current.map((job) => (job.id === id && job.status === "queued" ? { ...job, status: "cancelled" } : job))
      )
    },
    []
  )

  const dismiss = React.useCallback((id: string) => {
    setJobs((current) => current.filter((job) => job.id !== id))
  }, [])

  const clearFinished = React.useCallback(() => {
    setJobs((current) => current.filter((job) => job.status === "queued" || job.status === "uploading"))
  }, [])

  // Leaving the page mid-upload loses the partial file.
  const active = jobs.some((job) => job.status === "queued" || job.status === "uploading")
  React.useEffect(() => {
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [active])

  return { jobs, add, cancel, dismiss, clearFinished }
}
