service := "gokapi-admin.service"
route := "files-ui"
port := "53844"

default:
    @just --list

# Start the Vite dev server on http://127.0.0.1:5181, forwarding /api to the local Gokapi
dev:
    pnpm dev

# Install dependencies
install-deps:
    pnpm install

# Build the app into dist/
build:
    pnpm build

# Lint, check bundled icons, type-check, and build
check:
    pnpm check

# Regenerate the bundled Material Symbols after using a new icon
icons:
    pnpm gen:icons

# Serve dist/ on 127.0.0.1:53844 in the foreground, without the user service
serve: build
    pnpm start

# Install and start the user service on port 53844
install: build
    mkdir -p ~/.config/systemd/user
    cp deploy/{{service}} ~/.config/systemd/user/{{service}}
    systemctl --user daemon-reload
    systemctl --user enable --now {{service}}

# Rebuild the app and restart the user service
update: build
    systemctl --user restart {{service}}

# Show the user service status
status:
    systemctl --user status {{service}} --no-pager

# Follow the user service logs
logs:
    journalctl --user-unit {{service}} --follow --lines=100

# Stop and disable the user service. Gokapi and its own /admin page keep working.
uninstall:
    systemctl --user disable --now {{service}}
    rm -f ~/.config/systemd/user/{{service}}
    systemctl --user daemon-reload

# Publish the service on the tailnet as https://files-ui.<tailnet base domain>
route:
    cd ~/docker/dev-router && just specific {{route}} {{port}}
