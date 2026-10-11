#!/usr/bin/env bash
# ORCA Draw one-line installer (Linux / macOS)
#   wget -qO- https://raw.githubusercontent.com/nazmulislam-lab/orca-draw/main/install.sh | bash
# or
#   curl -fsSL https://raw.githubusercontent.com/nazmulislam-lab/orca-draw/main/install.sh | bash
set -euo pipefail

REPO="https://github.com/nazmulislam-lab/orca-draw.git"
DIR="${ORCA_DIR:-$HOME/.local/share/orca-draw}"
BIN="$HOME/.local/bin"
PORT="${ORCA_PORT:-5179}"

say() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v git  >/dev/null || die "git is required"
command -v node >/dev/null || die "Node.js 18+ is required (https://nodejs.org)"
command -v npm  >/dev/null || die "npm is required"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 18+ is required (found $(node -v))"

if [ -d "$DIR/.git" ]; then
  say "Updating ORCA Draw in $DIR"
  git -C "$DIR" pull --ff-only
else
  say "Downloading ORCA Draw to $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone --depth 1 "$REPO" "$DIR"
fi

say "Installing dependencies"
(cd "$DIR" && npm ci --no-audit --no-fund)
say "Building"
(cd "$DIR" && npm run build --silent)

say "Creating launcher: $BIN/orca-draw"
mkdir -p "$BIN"
cat > "$BIN/orca-draw" <<LAUNCH
#!/usr/bin/env bash
# Serves ORCA Draw locally and opens it in your browser.
cd "$DIR"
URL="http://localhost:$PORT/"
( sleep 1.5; xdg-open "\$URL" 2>/dev/null || open "\$URL" 2>/dev/null ) &
exec npx --no-install vite preview --port $PORT --strictPort
LAUNCH
chmod +x "$BIN/orca-draw"

if [ "$(uname)" = "Linux" ]; then
  APPS="$HOME/.local/share/applications"
  mkdir -p "$APPS"
  cat > "$APPS/orca-draw.desktop" <<DESK
[Desktop Entry]
Name=ORCA Draw
Comment=Hand-drawn style whiteboard
Exec=$BIN/orca-draw
Icon=applications-graphics
Terminal=false
Type=Application
Categories=Graphics;
DESK
  say "Added 'ORCA Draw' to your app menu"
fi

case ":$PATH:" in *":$BIN:"*) ;; *) say "Add $BIN to your PATH to run 'orca-draw' from a terminal";; esac
say "Done! Launch it with: orca-draw"
