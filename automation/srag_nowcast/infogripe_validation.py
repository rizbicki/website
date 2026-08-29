"""Production bundle checks specific to the published InfoGripe model."""

from __future__ import annotations

import json
from pathlib import Path


def validate_infogripe_output(
    output_dir: Path,
    summary: dict[str, object],
    ufs: list[str],
    max_age_days: float = 21.0,
) -> None:
    source = summary.get("sources", {}).get("infogripe")
    if not isinstance(source, dict):
        raise RuntimeError("Missing InfoGripe source metadata")
    for field in ["source", "url", "repository", "retrieved_at_utc", "latest_week"]:
        if not source.get(field):
            raise RuntimeError(f"Missing InfoGripe source field: {field}")
    if "InfoGripe" not in source["source"] or "Fiocruz" not in source["source"]:
        raise RuntimeError("InfoGripe credit must name InfoGripe and Fiocruz")
    age = source.get("latest_week_age_days")
    if not isinstance(age, int) or not -7 <= age <= max_age_days:
        raise RuntimeError(f"Invalid InfoGripe source age: {age}")

    for uf in ["BR", *ufs]:
        path = output_dir / "states" / f"{uf}.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        latest = payload.get("latest", {})
        if latest.get("infogripe_week") != source["latest_week"]:
            raise RuntimeError(f"InfoGripe latest week mismatch for {uf}")
        values = [
            latest.get("infogripe_reported"),
            latest.get("infogripe"),
            latest.get("infogripe_lower80"),
            latest.get("infogripe_upper80"),
        ]
        if any(not isinstance(value, (int, float)) or value < 0 for value in values):
            raise RuntimeError(f"Invalid latest InfoGripe values for {uf}")
        if latest["infogripe_lower80"] > latest["infogripe_upper80"]:
            raise RuntimeError(f"Inverted InfoGripe interval for {uf}")
        matching = [
            row
            for row in payload.get("series", [])
            if row.get("week") == latest["infogripe_week"]
        ]
        if len(matching) != 1 or matching[0].get("infogripe") != latest["infogripe"]:
            raise RuntimeError(f"InfoGripe latest/series mismatch for {uf}")
        score = payload.get("backtest", {}).get("infogripe")
        if not isinstance(score, dict) or score.get("note") is None:
            raise RuntimeError(f"Missing InfoGripe evaluation limitation for {uf}")
