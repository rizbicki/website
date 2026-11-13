"""Fetch the validated ViDAS release used by this website (standard library only)."""
from __future__ import annotations

import argparse
import hashlib
import json
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
RELEASES_API = "https://api.github.com/repos/rizbicki/vidas-dashboard/releases/latest"
ASSET_PREFIX = "https://github.com/rizbicki/vidas-dashboard/releases/download/"


def request(url: str):
    return urllib.request.urlopen(urllib.request.Request(
        url, headers={"User-Agent": "rafaelizbicki-website-vidas"}
    ), timeout=120)


def read_json(url: str) -> dict:
    with request(url) as response:
        return json.load(response)


def validate_manifest(record: dict):
    expected_url = f"{ASSET_PREFIX}{record['tag']}/vidas-dashboard.zip"
    if record["archive_url"] != expected_url:
        raise ValueError("Unexpected ViDAS release asset URL")
    if not re.fullmatch(r"build-\d+-\d+", record["tag"]):
        raise ValueError("Invalid ViDAS release tag")
    if not re.fullmatch(r"[0-9a-f]{64}", record["sha256"]):
        raise ValueError("Invalid ViDAS release checksum")


def update_manifest() -> bool:
    try:
        release = read_json(RELEASES_API)
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        print("The first ViDAS release is still being prepared")
        return False
    asset = next(a for a in release["assets"] if a["name"] == "build-info.json")
    expected_url = f"{ASSET_PREFIX}{release['tag_name']}/build-info.json"
    if asset["browser_download_url"] != expected_url:
        raise ValueError("Unexpected ViDAS provenance URL")
    record = read_json(expected_url)
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
    # The published package is pinned by URL and SHA-256, so website rebuilds
    # always use the same fitted models until the sync workflow promotes a release.
    with tempfile.TemporaryDirectory(prefix="vidas-bundle-") as temporary:
        staging = Path(temporary)
        archive = staging / "dashboard.zip"
        digest = hashlib.sha256()
        with request(record["archive_url"]) as response, archive.open("wb") as output:
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
