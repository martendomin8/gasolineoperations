#!/usr/bin/env python3
"""Maintain /weather/manifest.json — the index the frontend reads.

The manifest tells the browser what weather runs are available and
where each frame sits on the CDN. It is the single source of truth
that `NefgoWeatherProvider.getFrameTimes()` and
`getBracketingFrames()` read on every slider interaction.

Schema (v1):

    {
        "version": 1,
        "latest":  "2026042012",
        "runs": [
            {
                "runId":       "2026042012",
                "cycleTime":   "2026-04-20T12:00:00+00:00",
                "generatedAt": "2026-04-20T17:32:45+00:00",
                "frames": {
                    "wind": [
                        {
                            "forecastHour": 0,
                            "validTime":    "2026-04-20T12:00:00+00:00",
                            "pngUrl":       "https://.../wind_f000.png",
                            "jsonUrl":      "https://.../wind_f000.json"
                        },
                        ...
                    ],
                    "waves": [ ... ],
                    "temperature": [ ... ]
                }
            },
            ...  up to `keep_runs` most recent entries
        ]
    }

Usage patterns:

    # From the orchestrator, after all frames are uploaded:
    from update_manifest import Manifest, save_manifest_to_blob
    manifest = Manifest.load_from_blob(base_url)
    manifest.add_run(run_id="2026042012", cycle_time=..., frames={...})
    manifest.prune(keep=2)
    manifest.save_to_blob(base_url, token)

    # CLI debug:
    python update_manifest.py --dump        # print current manifest
    python update_manifest.py --prune 2     # keep 2 runs, drop rest
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

from upload_blob import upload_file

MANIFEST_PATHNAME = "weather/manifest.json"
SCHEMA_VERSION = 1

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class Frame:
    forecast_hour: int
    valid_time: str  # ISO-8601 UTC
    png_url: str
    json_url: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "forecastHour": self.forecast_hour,
            "validTime": self.valid_time,
            "pngUrl": self.png_url,
            "jsonUrl": self.json_url,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Frame":
        return cls(
            forecast_hour=int(d["forecastHour"]),
            valid_time=str(d["validTime"]),
            png_url=str(d["pngUrl"]),
            json_url=str(d["jsonUrl"]),
        )


@dataclass
class Run:
    run_id: str  # YYYYMMDDHH
    cycle_time: str  # ISO-8601
    generated_at: str  # ISO-8601
    frames: dict[str, list[Frame]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "runId": self.run_id,
            "cycleTime": self.cycle_time,
            "generatedAt": self.generated_at,
            "frames": {k: [f.to_dict() for f in v] for k, v in self.frames.items()},
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Run":
        return cls(
            run_id=str(d["runId"]),
            cycle_time=str(d["cycleTime"]),
            generated_at=str(d["generatedAt"]),
            frames={
                k: [Frame.from_dict(f) for f in v]
                for k, v in (d.get("frames") or {}).items()
            },
        )

    def all_file_urls(self) -> list[str]:
        """Every PNG + JSON URL this run published. Used when pruning a
        run from the manifest so we can delete the corresponding blobs
        and not let orphans accumulate in the store."""
        urls: list[str] = []
        for frames in self.frames.values():
            for f in frames:
                urls.append(f.png_url)
                urls.append(f.json_url)
        return urls


@dataclass
class Manifest:
    runs: list[Run] = field(default_factory=list)

    # -- construction ------------------------------------------------------

    @classmethod
    def empty(cls) -> "Manifest":
        return cls(runs=[])

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Manifest":
        runs = [Run.from_dict(r) for r in (d.get("runs") or [])]
        # Runs kept sorted oldest → newest so the last entry is always "latest".
        runs.sort(key=lambda r: r.run_id)
        return cls(runs=runs)

    @classmethod
    def load_from_blob(cls, base_url: str, timeout: float = 30.0) -> "Manifest":
        """Fetch the current manifest from the public CDN.

        Returns an empty manifest if the file doesn't exist yet (first
        pipeline run). Any other error is raised.
        """
        url = f"{base_url.rstrip('/')}/{MANIFEST_PATHNAME}"
        try:
            response = requests.get(url, timeout=timeout)
        except requests.RequestException as e:
            logger.warning(
                "Could not fetch existing manifest (network error: %s). Starting from empty.",
                e,
            )
            return cls.empty()
        if response.status_code == 404:
            logger.info("No existing manifest at %s. Starting from empty.", url)
            return cls.empty()
        response.raise_for_status()
        return cls.from_dict(response.json())

    @classmethod
    def load_from_file(cls, path: Path) -> "Manifest":
        """Load a manifest from a local file. Returns empty if missing.

        Used by the local demo pipeline (`run_pipeline.py --local`) so
        consecutive runs merge their runs into the same manifest.json
        file inside `public/weather/`.
        """
        if not path.exists():
            logger.info("No existing manifest at %s. Starting from empty.", path)
            return cls.empty()
        with path.open("r", encoding="utf-8") as f:
            return cls.from_dict(json.load(f))

    # -- mutation ----------------------------------------------------------

    def add_run(self, run: Run) -> None:
        """Insert or merge a run by runId, keeping runs sorted oldest → newest.

        If a run with the same runId already exists, we MERGE frames by
        weather type rather than replacing. This matters when the
        pipeline is invoked separately for wind then for waves (or any
        other per-type invocation) — the second run shouldn't clobber
        the first run's already-published frames.
        """
        existing = next((r for r in self.runs if r.run_id == run.run_id), None)
        if existing is None:
            self.runs.append(run)
        else:
            # Merge frames dict; the new run wins for any weather type
            # present in both (fresh data is fresher data).
            for weather_type, frames in run.frames.items():
                existing.frames[weather_type] = frames
            # Bump the generated_at so consumers can tell the run was updated.
            existing.generated_at = run.generated_at
        self.runs.sort(key=lambda r: r.run_id)

    def prune(self, keep: int) -> list[Run]:
        """Keep only the most recent `keep` runs. Returns the dropped ones."""
        if keep < 1:
            raise ValueError("keep must be >= 1")
        if len(self.runs) <= keep:
            return []
        dropped = self.runs[:-keep]
        self.runs = self.runs[-keep:]
        return dropped

    def prune_by_age(
        self,
        max_age_days: int,
        now: datetime | None = None,
    ) -> list[Run]:
        """Keep runs whose cycle_time is within `max_age_days` of `now`.

        Returns the dropped ones so the caller can delete the
        corresponding blob files. If `now` is None, uses the current UTC
        time — parameterised for tests.
        """
        if max_age_days < 1:
            raise ValueError("max_age_days must be >= 1")
        if now is None:
            now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=max_age_days)
        kept: list[Run] = []
        dropped: list[Run] = []
        for run in self.runs:
            try:
                cycle_dt = datetime.fromisoformat(run.cycle_time)
            except ValueError:
                # Malformed cycle_time — keep the run rather than silently
                # dropping it. A surprising stale entry is easier to debug
                # than a surprising missing one.
                logger.warning(
                    "Could not parse cycle_time %r for run %s; keeping.",
                    run.cycle_time,
                    run.run_id,
                )
                kept.append(run)
                continue
            if cycle_dt >= cutoff:
                kept.append(run)
            else:
                dropped.append(run)
        self.runs = kept
        return dropped

    # -- serialisation -----------------------------------------------------

    @property
    def latest_run_id(self) -> str | None:
        return self.runs[-1].run_id if self.runs else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": SCHEMA_VERSION,
            "latest": self.latest_run_id,
            "runs": [r.to_dict() for r in self.runs],
        }

    def save_to_file(self, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)
        return path

    def save_to_blob(
        self,
        token: str | None = None,
        scratch_dir: Path | None = None,
    ) -> str:
        """Write the manifest to a temp file and upload it to Blob.

        Returns the public URL of the uploaded manifest.
        """
        if scratch_dir is None:
            scratch_dir = Path("out")
        scratch_dir.mkdir(parents=True, exist_ok=True)
        temp_path = scratch_dir / "manifest.json"
        self.save_to_file(temp_path)
        return upload_file(
            local_path=temp_path,
            blob_pathname=MANIFEST_PATHNAME,
            token=token,
            content_type="application/json",
        )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _cmd_dump(args: argparse.Namespace) -> int:
    base_url = args.base_url or os.environ.get("NEXT_PUBLIC_WEATHER_CDN_BASE_URL")
    if not base_url:
        logger.error("Provide --base-url or set NEXT_PUBLIC_WEATHER_CDN_BASE_URL")
        return 2
    manifest = Manifest.load_from_blob(base_url)
    print(json.dumps(manifest.to_dict(), indent=2))
    return 0


def _cmd_prune(args: argparse.Namespace) -> int:
    base_url = args.base_url or os.environ.get("NEXT_PUBLIC_WEATHER_CDN_BASE_URL")
    if not base_url:
        logger.error("Provide --base-url or set NEXT_PUBLIC_WEATHER_CDN_BASE_URL")
        return 2
    manifest = Manifest.load_from_blob(base_url)
    dropped = manifest.prune(keep=args.keep)
    if dropped:
        logger.info("Dropped runs: %s", [r.run_id for r in dropped])
    else:
        logger.info("Nothing to prune — %d runs already <= keep=%d", len(manifest.runs), args.keep)
    if not args.dry_run:
        manifest.save_to_blob(token=args.token)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    subparsers = parser.add_subparsers(dest="command", required=True)

    dump = subparsers.add_parser("dump", help="Print current manifest as JSON")
    dump.add_argument("--base-url", type=str, default=None)
    dump.set_defaults(func=_cmd_dump)

    prune = subparsers.add_parser("prune", help="Drop old runs from the manifest")
    prune.add_argument("--keep", type=int, default=2)
    prune.add_argument("--dry-run", action="store_true")
    prune.add_argument("--base-url", type=str, default=None)
    prune.add_argument("--token", type=str, default=None)
    prune.set_defaults(func=_cmd_prune)

    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
