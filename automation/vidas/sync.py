"""Fetch the validated ViDAS release used by this website (standard library only)."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "automation/vidas/release.json"
DESTINATION = ROOT / "static/dashboard/vidas"
RELEASES_API = "https://api.github.com/repos/rizbicki/vidas-dashboard/releases"
ASSET_PREFIX = "https://github.com/rizbicki/vidas-dashboard/releases/download/"


def request(url: str, *, binary: bool = False):
    if not url.startswith(RELEASES_API + "/"):
        raise ValueError("Unexpected ViDAS API URL")
    token = os.environ.get("VIDAS_READ_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "Set VIDAS_READ_TOKEN with Contents: read access to rizbicki/vidas-dashboard "
            "in the website Actions secrets and Netlify build environment."
        )
    req = urllib.request.Request(url, headers={
        "User-Agent": "rafaelizbicki-website-vidas",
        "Accept": "application/octet-stream" if binary else "application/vnd.github+json",
    })
    # urllib excludes unredirected headers when following signed asset-download URLs.
    req.add_unredirected_header("Authorization", f"Bearer {token}")
    try:
        return urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 404):
            raise RuntimeError(
                f"ViDAS GitHub request failed (HTTP {exc.code}). Check VIDAS_READ_TOKEN, "
                "its expiration and Contents: read permission, and that the release exists."
            ) from None
        raise


def read_json(url: str) -> dict:
    with request(url) as response:
        return json.load(response)


def release_asset(release: dict, name: str):
    tag = release["tag_name"]
    if not re.fullmatch(r"build-\d+-\d+", tag):
        raise ValueError("Invalid ViDAS release tag")
    asset = next(a for a in release["assets"] if a["name"] == name)
    if asset["browser_download_url"] != f"{ASSET_PREFIX}{tag}/{name}":
        raise ValueError("Unexpected ViDAS release asset URL")
    if type(asset["id"]) is not int or asset["id"] <= 0:
        raise ValueError("Invalid ViDAS release asset ID")
    return request(f"{RELEASES_API}/assets/{asset['id']}", binary=True)


def validate_manifest(record: dict):
    expected_url = f"{ASSET_PREFIX}{record['tag']}/vidas-dashboard.zip"
    if record["archive_url"] != expected_url:
        raise ValueError("Unexpected ViDAS release asset URL")
    if not re.fullmatch(r"build-\d+-\d+", record["tag"]):
        raise ValueError("Invalid ViDAS release tag")
    if not re.fullmatch(r"[0-9a-f]{64}", record["sha256"]):
        raise ValueError("Invalid ViDAS release checksum")


def update_manifest() -> bool:
    release = read_json(f"{RELEASES_API}/latest")
    with release_asset(release, "build-info.json") as response:
        record = json.load(response)
    validate_manifest(record)
    if record["tag"] != release["tag_name"]:
        raise ValueError("Release tag does not match the build provenance")
    contents = json.dumps(record, ensure_ascii=False, indent=2) + "\n"
    if MANIFEST.exists() and MANIFEST.read_text(encoding="utf-8") == contents:
        print(f"ViDAS {record['tag']} is already selected")
        return False
    MANIFEST.write_text(contents, encoding="utf-8")
    print(f"Selected ViDAS {record['tag']} (base {record['release_date']})")
    return True


def extract_bundle(archive: Path, destination: Path):
    root = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            # Reject absolute paths, Windows drive names, traversal and symlinks.
            name = entry.filename.replace("\\", "/")
            target = (root / name).resolve()
            if ":" in name or not target.is_relative_to(root) or name.startswith("/"):
                raise ValueError(f"Unsafe archive path: {entry.filename}")
            if entry.external_attr >> 16 & 0o170000 == 0o120000:
                raise ValueError(f"Archive contains a symbolic link: {entry.filename}")
        bundle.extractall(root)


def fetch_bundle(record: dict, destination: Path = DESTINATION):
    validate_manifest(record)
    release = read_json(f"{RELEASES_API}/tags/{record['tag']}")
    if release["tag_name"] != record["tag"]:
        raise ValueError("Release tag does not match the pinned build provenance")
    # The published package is pinned by URL and SHA-256, so website rebuilds
    # always use the same fitted models until the sync workflow promotes a release.
    with tempfile.TemporaryDirectory(prefix="vidas-bundle-") as temporary:
        staging = Path(temporary)
        archive = staging / "dashboard.zip"
        digest = hashlib.sha256()
        with release_asset(release, "vidas-dashboard.zip") as response, archive.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
        if digest.hexdigest() != record["sha256"]:
            raise ValueError("ViDAS archive checksum does not match the pinned release")
        extracted = staging / "web"
        extract_bundle(archive, extracted)
        required = (
            "index.html", "css/app.css", "js/main.js", "js/worker.js", "js/gbdt.js",
            "data/meta.json", "data/places.json", "data/overview.json", "data/geo.json",
            "data/delay.json", "data/series/BR.json", "data/models/virus.json",
            "data/models/virus.bin", "data/models/age.json", "data/models/age.bin",
        )
        for name in required:
            if not (extracted / name).is_file() or (extracted / name).stat().st_size == 0:
                raise ValueError(f"Missing or empty ViDAS file: {name}")
        meta = json.loads((extracted / "data/meta.json").read_text(encoding="utf-8"))
        if meta["release_date"] != record["release_date"] or meta["built_at"] != record["built_at"]:
            raise ValueError("ViDAS data does not match the pinned build provenance")

        resolved = destination.resolve()
        allowed_root = (ROOT / "static/dashboard").resolve()
        if (not allowed_root.is_relative_to(ROOT.resolve())
                or resolved != allowed_root / "vidas" or destination.is_symlink()):
            raise ValueError(f"Unexpected dashboard destination: {resolved}")
        # Verify the absolute target before replacing this generated directory.
        if resolved.exists():
            shutil.rmtree(resolved)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(extracted, resolved)
    print(f"Prepared /dashboard/vidas/: {record['tag']} (base {record['release_date']})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update-manifest", action="store_true")
    args = parser.parse_args()
    if args.update_manifest:
        update_manifest()
    elif not MANIFEST.exists():
        # First deployment only: make the final URL useful while the initial
        # model fit runs. The scheduled promotion replaces this page atomically.
        DESTINATION.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(Path(__file__).with_name("pending.html"), DESTINATION / "index.html")
        print("Prepared the ViDAS first-release status page")
    else:
        fetch_bundle(json.loads(MANIFEST.read_text(encoding="utf-8")))


if __name__ == "__main__":
    main()
