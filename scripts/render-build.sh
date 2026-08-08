#!/usr/bin/env bash
set -euo pipefail

# Keep the browser binary inside the deployed build instead of relying on a
# machine-local Playwright cache that might not be present at runtime.
export PLAYWRIGHT_BROWSERS_PATH=0

python -m pip install -r requirements.txt
npm ci
npx playwright install --with-deps chromium
