#!/usr/bin/env bash
# Build and deploy STUNTLINE to gs://stuntline.getposta.app.
# Cloudflare CNAME stuntline -> c.storage.googleapis.com (Proxied) serves it as
# https://stuntline.getposta.app
set -euo pipefail

BUCKET="stuntline.getposta.app"
PROJECT="gifted-palace-464208-n2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/dist"

cd "$ROOT"

# ── Bucket bootstrap (idempotent) ─────────────────────────────────────
if ! gcloud storage buckets describe "gs://${BUCKET}" --project="$PROJECT" >/dev/null 2>&1; then
    echo "==> Creating bucket gs://${BUCKET}"
    gcloud storage buckets create "gs://${BUCKET}" \
        --project="$PROJECT" \
        --location="EU" \
        --uniform-bucket-level-access
    echo "==> Granting public read"
    gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
        --project="$PROJECT" \
        --member=allUsers \
        --role=roles/storage.objectViewer >/dev/null
    echo "==> Configuring website mode (index.html / 404.html)"
    gcloud storage buckets update "gs://${BUCKET}" \
        --project="$PROJECT" \
        --web-main-page-suffix=index.html \
        --web-error-page=index.html
fi

echo "==> Building"
rm -rf "$OUT"
npm run build

echo "==> Uploading to gs://${BUCKET}"
gcloud storage rsync \
    --recursive \
    --delete-unmatched-destination-objects \
    --project="$PROJECT" \
    "$OUT/" "gs://${BUCKET}/"

echo "==> Setting cache headers"
# HTML refreshes quickly; hashed assets are immutable.
gcloud storage objects update "gs://${BUCKET}/index.html" \
    --cache-control="public, max-age=300, must-revalidate" \
    --project="$PROJECT" >/dev/null
gcloud storage objects update "gs://${BUCKET}/assets/**" \
    --cache-control="public, max-age=31536000, immutable" \
    --project="$PROJECT" >/dev/null 2>&1 || true

echo
echo "==> Done."
echo "    Bucket:    gs://${BUCKET}"
echo "    Test URL:  https://c.storage.googleapis.com/${BUCKET}/index.html"
echo "    Live URL:  https://stuntline.getposta.app  (once Cloudflare CNAME is live)"
echo
echo "    To purge Cloudflare cache after a deploy:"
echo "       Cloudflare dashboard -> Caching -> Purge Everything"
