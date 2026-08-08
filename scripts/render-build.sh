#!/usr/bin/env bash
set -euo pipefail

# Keep the browser binary inside the deployed build instead of relying on a
# machine-local Playwright cache that might not be present at runtime.
export PLAYWRIGHT_BROWSERS_PATH=0

python -m pip install -r requirements.txt
npm ci
# Render native runtimes do not grant root/su during builds. Installing the
# Playwright browser itself is user-scoped; `--with-deps` would try to use the
# OS package manager and fail with an authentication error.
npx playwright install chromium

if [[ ! -f "node_modules/@fontsource-variable/noto-sans-kr/index.css" ]]; then
    echo "Bundled Noto Sans KR report font is missing." >&2
    exit 1
fi

# Fail the deployment during the build, instead of discovering a missing
# browser/runtime only after a user requests a PDF in production.
pdf_smoke_file="$(mktemp)"
cleanup_pdf_smoke() {
    rm -f "${pdf_smoke_file}"
}
trap cleanup_pdf_smoke EXIT
printf '<!doctype html><html><body><h1>IN-DEPS PDF smoke test</h1></body></html>' \
    | node scripts/render_report_pdf.mjs > "${pdf_smoke_file}"
if [[ "$(head -c 5 "${pdf_smoke_file}")" != "%PDF-" ]]; then
    echo "Playwright Chromium PDF smoke test failed." >&2
    exit 1
fi
echo "Playwright Chromium PDF smoke test passed."
