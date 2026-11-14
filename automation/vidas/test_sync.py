"""Private release authentication and pinned-bundle integrity checks (offline)."""
import hashlib
import io
import json
import os
import tempfile
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from unittest.mock import patch

import sync


class PrivateReleaseTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"VIDAS_READ_TOKEN": "test-token"})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_token_is_not_forwarded_to_asset_redirect(self):
        with patch.object(sync.urllib.request, "urlopen") as open_url:
            sync.request(f"{sync.RELEASES_API}/assets/123", binary=True)
        req = open_url.call_args.args[0]
        self.assertEqual(req.get_header("Authorization"), "Bearer test-token")
        self.assertEqual(req.get_header("Accept"), "application/octet-stream")
        redirected = urllib.request.HTTPRedirectHandler().redirect_request(
            req, None, 302, "Found", {}, "https://release-assets.githubusercontent.com/bundle"
        )
        self.assertIsNone(redirected.get_header("Authorization"))

    def test_missing_token_fails_before_network_request(self):
        with patch.dict(os.environ, {"VIDAS_READ_TOKEN": ""}), patch.object(
            sync.urllib.request, "urlopen"
        ) as open_url:
            with self.assertRaisesRegex(RuntimeError, "Set VIDAS_READ_TOKEN"):
                sync.read_json(f"{sync.RELEASES_API}/latest")
            open_url.assert_not_called()

    def test_token_cannot_be_sent_to_another_host_or_repository(self):
        for url in ("https://example.com/file", sync.RELEASES_API + "-other/latest"):
            with self.subTest(url=url), patch.object(sync.urllib.request, "urlopen") as open_url:
                with self.assertRaises(ValueError):
                    sync.request(url)
                open_url.assert_not_called()

    def test_auth_failure_is_reported_without_hiding_it_as_first_release(self):
        error = urllib.error.HTTPError(f"{sync.RELEASES_API}/latest", 404, "Not Found", {}, None)
        with patch.object(sync.urllib.request, "urlopen", side_effect=error):
            with self.assertRaisesRegex(RuntimeError, "HTTP 404.*VIDAS_READ_TOKEN"):
                sync.update_manifest()

    def release(self, record):
        tag = record["tag"]
        return {"tag_name": tag, "assets": [
            {"id": asset_id, "name": name,
             "browser_download_url": f"{sync.ASSET_PREFIX}{tag}/{name}"}
            for asset_id, name in ((123, "vidas-dashboard.zip"), (124, "build-info.json"))
        ]}

    def bundle(self):
        record = {"tag": "build-123-1", "release_date": "2026-11-09", "built_at": "example"}
        record["archive_url"] = f"{sync.ASSET_PREFIX}{record['tag']}/vidas-dashboard.zip"
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            for name in (
                "index.html", "css/app.css", "js/main.js", "js/worker.js", "js/gbdt.js",
                "data/places.json", "data/overview.json", "data/geo.json", "data/delay.json",
                "data/series/BR.json", "data/models/virus.json", "data/models/virus.bin",
                "data/models/age.json", "data/models/age.bin",
            ):
                archive.writestr(name, "test")
            archive.writestr("data/meta.json", json.dumps(record))
        content = output.getvalue()
        record["sha256"] = hashlib.sha256(content).hexdigest()
        return record, content

    def test_private_provenance_asset_updates_manifest(self):
        record, _ = self.bundle()
        with tempfile.TemporaryDirectory() as temp:
            manifest = Path(temp) / "release.json"
            with patch.object(sync, "MANIFEST", manifest), patch.object(
                sync, "read_json", return_value=self.release(record)
            ) as read_json, patch.object(
                sync, "request", return_value=io.BytesIO(json.dumps(record).encode())
            ) as request:
                self.assertTrue(sync.update_manifest())
                self.assertEqual(json.loads(manifest.read_text()), record)
                read_json.assert_called_once_with(f"{sync.RELEASES_API}/latest")
                request.assert_called_once_with(f"{sync.RELEASES_API}/assets/124", binary=True)

    def test_pinned_private_bundle_download_and_corruption_preserve_previous_deploy(self):
        record, content = self.bundle()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            destination = root / "static/dashboard/vidas"
            with patch.object(sync, "ROOT", root), patch.object(
                sync, "read_json", return_value=self.release(record)
            ) as read_json, patch.object(
                sync, "request", side_effect=lambda *a, **kw: io.BytesIO(content)
            ) as request:
                sync.fetch_bundle(record, destination)
                self.assertEqual((destination / "index.html").read_text(), "test")
                read_json.assert_called_once_with(f"{sync.RELEASES_API}/tags/{record['tag']}")
                request.assert_called_once_with(f"{sync.RELEASES_API}/assets/123", binary=True)
                request.side_effect = lambda *a, **kw: io.BytesIO(b"corrupt")
                with self.assertRaisesRegex(ValueError, "checksum"):
                    sync.fetch_bundle(record, destination)
                self.assertEqual((destination / "index.html").read_text(), "test")

    def test_unexpected_asset_url_is_rejected_before_download(self):
        record, _ = self.bundle()
        release = self.release(record)
        release["assets"][0]["browser_download_url"] = "https://example.com/asset"
        with patch.object(sync, "request") as request:
            with self.assertRaises(ValueError):
                sync.release_asset(release, "vidas-dashboard.zip")
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
