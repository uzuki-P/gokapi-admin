import * as React from "react"

import { Button } from "@/components/m3e/button"
import { Icon } from "@/components/m3e/icon"
import { Progress } from "@/components/m3e/progress"
import { TextField } from "@/components/m3e/text-field"
import { ToggleGroup, ToggleGroupItem } from "@/components/m3e/toggle-group"
import type { UploadOptions } from "@/lib/gokapi"
import { formatBytes } from "@/lib/format"

import type { UploadJob } from "./useUploads"

type Choice = { value: string; label: string }
const EXPIRY: Choice[] = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "0", label: "Never" },
]
const DOWNLOADS: Choice[] = [
  { value: "1", label: "1" },
  { value: "5", label: "5" },
  { value: "20", label: "20" },
  { value: "0", label: "Unlimited" },
]

// bin/share defaults: seven days, unlimited downloads.
const DEFAULT_OPTIONS = { expiryDays: 7, allowedDownloads: 0 }
const OPTIONS_KEY = "gokapi-admin.upload-options"

function readOptions(): typeof DEFAULT_OPTIONS {
  try {
    return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}") }
  } catch {
    return DEFAULT_OPTIONS
  }
}

// Browsers only send Latin-1 header values, and Gokapi takes the password
// as a header. ASCII keeps it typeable on every device.
const ASCII = /^[\x20-\x7e]*$/

export function UploadPanel({
  jobs,
  onAdd,
  onCancel,
  onDismiss,
  onClearFinished,
}: {
  jobs: UploadJob[]
  onAdd: (files: File[], options: UploadOptions) => void
  onCancel: (id: string) => void
  onDismiss: (id: string) => void
  onClearFinished: () => void
}) {
  const [options, setOptions] = React.useState(readOptions)
  const [password, setPassword] = React.useState("")
  const input = React.useRef<HTMLInputElement>(null)
  const passwordValid = ASCII.test(password)

  function change(patch: Partial<typeof DEFAULT_OPTIONS>) {
    const next = { ...options, ...patch }
    setOptions(next)
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next))
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  }

  function addFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0 || !passwordValid) return
    onAdd([...files], { ...options, password })
  }

  // The window-wide drop target in FilesScreen calls this too.
  React.useEffect(() => {
    const onDrop = (event: Event) => addFiles((event as CustomEvent<File[]>).detail)
    window.addEventListener("gokapi-admin:drop", onDrop)
    return () => window.removeEventListener("gokapi-admin:drop", onDrop)
  })

  const finished = jobs.some((job) => job.status !== "queued" && job.status !== "uploading")

  return (
    <section aria-labelledby="upload-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-5 rounded-3xl bg-surface-container-low p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container">
            <Icon name="upload" size={28} />
          </div>
          <div className="min-w-0 flex-1 basis-56">
            <h2 id="upload-heading" className="text-title-large">
              Upload
            </h2>
            <p className="text-body-medium text-on-surface-variant">
              Drop files anywhere on this page, or choose them.
            </p>
          </div>
          <Button
            size="md"
            className="w-full sm:w-auto"
            onClick={() => input.current?.click()}
            disabled={!passwordValid}
          >
            <Icon name="add" data-icon="inline-start" />
            Choose files
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addFiles(event.target.files)
              event.target.value = ""
            }}
          />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <OptionGroup
            label="Expires after"
            choices={EXPIRY}
            value={String(options.expiryDays)}
            onChange={(value) => change({ expiryDays: Number(value) })}
          />
          <OptionGroup
            label="Downloads allowed"
            choices={DOWNLOADS}
            value={String(options.allowedDownloads)}
            onChange={(value) => change({ allowedDownloads: Number(value) })}
          />
        </div>
        <TextField
          label="Download password (optional)"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          leadingIcon={<Icon name="lock" />}
          error={!passwordValid}
          errorText="Use letters, digits, and ASCII symbols only."
          supportingText="Applies to the files you add next. Not remembered."
          containerClassName="md:max-w-md"
        />
      </div>

      {jobs.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-title-small text-on-surface-variant">Uploads</h3>
            {finished && (
              <Button variant="text" size="sm" onClick={onClearFinished}>
                Clear finished
              </Button>
            )}
          </div>
          <ul className="flex flex-col gap-0.5">
            {jobs.map((job) => (
              <UploadRow
                key={job.id}
                job={job}
                onCancel={() => onCancel(job.id)}
                onDismiss={() => onDismiss(job.id)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function OptionGroup({
  label,
  choices,
  value,
  onChange,
}: {
  label: string
  choices: Choice[]
  value: string
  onChange: (value: string) => void
}) {
  const id = React.useId()
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-label-large text-on-surface-variant">
        {label}
      </span>
      <ToggleGroup
        aria-labelledby={id}
        spacing={0}
        className="w-full"
        value={[value]}
        onValueChange={(next) => next[0] && onChange(next[0])}
      >
        {choices.map((choice) => (
          <ToggleGroupItem key={choice.value} value={choice.value}>
            {choice.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

const STATUS_TEXT = {
  queued: "Waiting",
  uploading: "Uploading",
  done: "Uploaded",
  failed: "Failed",
  cancelled: "Cancelled",
} as const

function UploadRow({
  job,
  onCancel,
  onDismiss,
}: {
  job: UploadJob
  onCancel: () => void
  onDismiss: () => void
}) {
  const active = job.status === "queued" || job.status === "uploading"
  const percent = job.file.size === 0 ? 100 : Math.round((job.sent / job.file.size) * 100)
  return (
    <li className="flex items-center gap-4 rounded-xs bg-surface-container px-4 py-3 first:rounded-t-xl last:rounded-b-xl only:rounded-xl">
      <Icon
        name={job.status === "done" ? "check_circle" : job.status === "failed" ? "error" : "upload_file"}
        className={job.status === "failed" ? "text-error" : job.status === "done" ? "text-primary" : "text-on-surface-variant"}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-body-large">{job.file.name}</span>
          <span className="shrink-0 text-body-small text-on-surface-variant tabular-nums">
            {job.status === "uploading"
              ? `${formatBytes(job.sent)} of ${formatBytes(job.file.size)}`
              : job.status === "failed"
                ? job.error
                : `${STATUS_TEXT[job.status]}, ${formatBytes(job.file.size)}`}
          </span>
        </div>
        {active && (
          <Progress
            aria-label={`${job.file.name} upload progress`}
            variant="wavy"
            value={job.status === "queued" ? null : percent}
          />
        )}
      </div>
      {active ? (
        <Button variant="ghost" size="icon-sm" aria-label={`Cancel ${job.file.name}`} onClick={onCancel}>
          <Icon name="close" />
        </Button>
      ) : (
        <Button variant="ghost" size="icon-sm" aria-label={`Dismiss ${job.file.name}`} onClick={onDismiss}>
          <Icon name="close" />
        </Button>
      )}
    </li>
  )
}
