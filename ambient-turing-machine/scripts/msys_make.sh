#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="$1"
export PATH="/usr/bin:/bin:/mingw64/bin:/c/Program Files (x86)/Arm GNU Toolchain arm-none-eabi/14.2 rel1/bin:$PATH"

if [[ "$TARGET_DIR" == [A-Za-z]:* ]]; then
  TARGET_DIR="$(cygpath -u "$TARGET_DIR")"
fi

cd "$TARGET_DIR"
make -j4
