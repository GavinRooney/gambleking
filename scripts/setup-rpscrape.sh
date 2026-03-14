#!/usr/bin/env bash
set -euo pipefail

# ─── Find Python 3.13+ ───────────────────────────────────────────────────────

PYTHON=""
for candidate in python3.13 python3; do
  if command -v "$candidate" &>/dev/null; then
    PY_VERSION=$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
    PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
    if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 13 ]; then
      PYTHON="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "Error: Python 3.13+ not found."
  echo "Install from https://www.python.org/downloads/ or: brew install python@3.13"
  exit 1
fi

PIP="${PYTHON/python/pip}"
if ! command -v "$PIP" &>/dev/null; then
  PIP="$PYTHON -m pip"
fi

echo "Using $PYTHON ($PY_VERSION)"

# ─── Clone rpscrape ──────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RPSCRAPE_DIR="$PROJECT_DIR/rpscrape"

if [ -d "$RPSCRAPE_DIR" ]; then
  echo "rpscrape already cloned at $RPSCRAPE_DIR"
else
  echo "Cloning rpscrape..."
  git clone https://github.com/joenano/rpscrape.git "$RPSCRAPE_DIR"
fi

# ─── Install Python dependencies ─────────────────────────────────────────────

echo "Setting up Python virtual environment..."
cd "$RPSCRAPE_DIR"
$PYTHON -m venv .venv
source .venv/bin/activate
echo "Installing Python dependencies..."
pip install -r requirements.txt

# ─── Configure rpscrape output columns ───────────────────────────────────────

SETTINGS_DIR="$RPSCRAPE_DIR/settings"
mkdir -p "$SETTINGS_DIR"

if [ ! -f "$SETTINGS_DIR/user_settings.toml" ]; then
  if [ -f "$SETTINGS_DIR/default_settings.toml" ]; then
    cp "$SETTINGS_DIR/default_settings.toml" "$SETTINGS_DIR/user_settings.toml"
    echo "Created user_settings.toml from default_settings.toml"
  else
    echo "Warning: No default_settings.toml found. You may need to configure rpscrape manually."
    echo "Ensure output includes: date, course, time, dist, going, type, pos, horse, age, sex, lbs, jockey, trainer, or, sp, draw, sire, dam, btn, ovr_btn"
  fi
fi

# ─── Done ────────────────────────────────────────────────────────────────────

echo ""
echo "Setup complete! Now run the scraper:"
echo ""
echo "  cd $RPSCRAPE_DIR"
echo "  source .venv/bin/activate"
echo "  python scripts/rpscrape.py -r gb -y 2020-2025"
echo "  python scripts/rpscrape.py -r ire -y 2020-2025"
echo ""
echo "Then import the data:"
echo ""
echo "  cd $PROJECT_DIR"
echo "  npm run db:seed -- ./rpscrape/data"
echo ""
