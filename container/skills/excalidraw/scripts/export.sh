#!/bin/bash
# Export .excalidraw file to SVG and/or PNG
# Usage: bash export.sh <input.excalidraw> [output_dir] [format: svg|png|both]
#
# Dependencies:
#   SVG: curl (for Kroki.io API)
#   PNG: node + sharp (auto-installs if missing)
#
# Examples:
#   bash export.sh diagram.excalidraw                     # → both svg+png in same dir
#   bash export.sh diagram.excalidraw ~/Downloads png     # → png only in ~/Downloads
#   bash export.sh diagram.excalidraw . svg               # → svg only in current dir

set -e

INPUT="$1"
OUTPUT_DIR="${2:-.}"
FORMAT="${3:-both}"

if [ -z "$INPUT" ] || [ ! -f "$INPUT" ]; then
  echo "Error: input file not found: $INPUT" >&2
  exit 1
fi

BASENAME=$(basename "$INPUT" .excalidraw)
mkdir -p "$OUTPUT_DIR"

# Step 1: .excalidraw → SVG via Kroki.io (deflate + base64url + GET)
export_svg() {
  local svg_path="$OUTPUT_DIR/$BASENAME.svg"
  local encoded
  encoded=$(python3 -c "
import zlib, base64, sys
with open('$INPUT', 'rb') as f:
    data = f.read()
print(base64.urlsafe_b64encode(zlib.compress(data)).decode())
")
  curl -sf "https://kroki.io/excalidraw/svg/$encoded" -o "$svg_path"
  echo "$svg_path"
}

# Step 2: SVG → PNG via sharp (Node.js)
export_png() {
  local svg_path="$1"
  local png_path="$OUTPUT_DIR/$BASENAME.png"

  # Auto-install sharp if missing
  if [ ! -d "/tmp/node_modules/sharp" ]; then
    echo "Installing sharp..." >&2
    (cd /tmp && npm install --silent sharp 2>/dev/null)
  fi

  node -e "
    const sharp = require('/tmp/node_modules/sharp');
    const fs = require('fs');
    const svg = fs.readFileSync('$svg_path');
    sharp(svg, { density: 300 })
      .png()
      .toFile('$png_path')
      .then(() => console.log('$png_path'));
  "
}

case "$FORMAT" in
  svg)
    svg_path=$(export_svg)
    echo "SVG: $svg_path"
    ;;
  png)
    svg_path=$(export_svg)
    png_path=$(export_png "$svg_path")
    rm -f "$svg_path"  # clean up intermediate SVG
    echo "PNG: $png_path"
    ;;
  both|*)
    svg_path=$(export_svg)
    png_path=$(export_png "$svg_path")
    echo "SVG: $svg_path"
    echo "PNG: $png_path"
    ;;
esac
