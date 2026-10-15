// Applies the saved color mode before first paint. "color-mode" is
// ColorModeProvider's storageKey. External so the CSP needs no inline script.
try {
  const mode = localStorage.getItem("color-mode") || "system"
  const dark =
    mode === "dark" ||
    (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.add(dark ? "dark" : "light")
} catch {
  // Storage blocked: ColorModeProvider still applies the mode after load.
}
