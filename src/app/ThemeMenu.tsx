import { Button } from "@/components/m3e/button"
import { useColorMode, type ColorMode } from "@/components/m3e/color-mode-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/m3e/dropdown-menu"
import { Icon } from "@/components/m3e/icon"

const MODES: { mode: ColorMode; label: string; icon: string }[] = [
  { mode: "system", label: "System", icon: "brightness_auto" },
  { mode: "light", label: "Light", icon: "light_mode" },
  { mode: "dark", label: "Dark", icon: "dark_mode" },
]

export function ThemeMenu() {
  const { mode, resolvedMode, setMode } = useColorMode()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Theme">
            <Icon name={resolvedMode === "dark" ? "dark_mode" : "light_mode"} />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as ColorMode)}
          >
            {MODES.map(({ mode: value, label, icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon name={icon} size={20} />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
