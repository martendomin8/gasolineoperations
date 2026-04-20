#!/usr/bin/env python3
"""Upload encoded weather frames to Vercel Blob storage.

Vercel Blob exposes an HTTP PUT API that the `@vercel/blob` SDK calls
under the hood:

    PUT https://blob.vercel-storage.com/<pathname>
    Authorization: Bearer <BLOB_READ_WRITE_TOKEN>
    Content-Type: <mime>
    x-api-version: 7
    x-add-random-suffix: 0        # keep deterministic URLs

Required env var:

    BLOB_READ_WRITE_TOKEN   — generated in the Vercel dashboard under
                              Storage → Blob → <store> → Tokens.
                              Exposed as a GitHub Actions secret of the
                              same name for the cron workflow.

Deterministic pathnames matter for us because the frontend fetches the
manifest from a stable URL each run — we don't want a random hash
appended, hence `x-add-random-suffix: 0`.

Usage (CLI):
    python upload_blob.py out/wind_f024.png --blob-path weather/2026042012/wind_f024.png
    python upload_blob.py out/wind_f024.json --blob-path weather/2026042012/wind_f024.json

Usage (module):
    from upload_blob import upload_file
    url = upload_file(Path("out/wind_f024.png"), "weather/2026042012/wind_f024.png")
"""
from __future__ import annotations

import argparse
import logging
import mimetypes
import os
import sys
from pathlib import Path

import requests

BLOB_API_BASE = os.getenv("VERCEL_BLOB_API_BASE", "https://blob.vercel-storage.com")

logger = logging.getLogger(__name__)


def _infer_content_type(local_path: Path) -> str:
    """Best-effort content-type sniff from the file extension.

    Defaults to application/octet-stream when unknown so the upload
    still succeeds — Vercel Blob will serve the file with whatever
    Content-Type we send.
    """
    guess, _ = mimetypes.guess_type(local_path.name)
    return guess or "application/octet-stream"


def upload_file(
    local_path: Path,
    blob_pathname: str,
    token: str | None = None,
    content_type: str | None = None,
    timeout: float = 60.0,
) -> str:
    """Upload a local file to Vercel Blob at `blob_pathname`.

    Returns the resulting public URL.

    `blob_pathname` is the destination path inside the Blob store, e.g.
    `weather/2026042012/wind_f024.png`. Leading slashes are stripped —
    Vercel treats the pathname as relative to the store root.
    """
    if token is None:
        token = os.environ.get("BLOB_READ_WRITE_TOKEN")
    if not token:
        raise RuntimeError(
            "BLOB_READ_WRITE_TOKEN is not set. Export it in the shell, or "
            "pass --token on the command line. Generate one in the Vercel "
            "dashboard under Storage → Blob → <store> → Tokens."
        )

    if content_type is None:
        content_type = _infer_content_type(local_path)

    blob_pathname = blob_pathname.lstrip("/")
    url = f"{BLOB_API_BASE}/{blob_pathname}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": content_type,
        "x-api-version": "7",
        "x-add-random-suffix": "0",
    }

    size_kb = local_path.stat().st_size / 1024
    logger.info("Uploading %s (%.1f KB) → %s", local_path, size_kb, url)
    with local_path.open("rb") as f:
        response = requests.put(url, headers=headers, data=f, timeout=timeout)
    response.raise_for_status()

    # The SDK returns a JSON payload shaped like:
    #   { "url": "...", "downloadUrl": "...", "pathname": "...", ... }
    payload = response.json()
    public_url: str = payload["url"]
    logger.info("Uploaded: %s", public_url)
    return public_url


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Upload one file to Vercel Blob")
    parser.add_argument("local_path", type=Path, help="File to upload")
    parser.add_argument(
        "--blob-path",
        type=str,
        required=True,
        help="Destination pathname inside the Blob store, e.g. weather/2026042012/wind_f024.png",
    )
    parser.add_argument(
        "--token",
        type=str,
        default=None,
        help="Blob token (defaults to $BLOB_READ_WRITE_TOKEN)",
    )
    parser.add_argument("--content-type", type=str, default=None)
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    if not args.local_path.is_file():
        logger.error("Not a file: %s", args.local_path)
        return 2

    try:
        url = upload_file(
            local_path=args.local_path,
            blob_pathname=args.blob_path,
            token=args.token,
            content_type=args.content_type,
        )
    except RuntimeError as e:
        logger.error("%s", e)
        return 3
    except requests.HTTPError as e:
        logger.error(
            "Blob API rejected upload (status %s): %s",
            e.response.status_code if e.response is not None else "?",
            e,
        )
        if e.response is not None:
            logger.error("Response body: %s", e.response.text[:500])
        return 4

    print(url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
