"""Production bundle checks for the harmonized InfoGripe mixture."""

from __future__ import annotations

import json
from pathlib import Path


def _nonnegative_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value >= 0
    )


def validate_infogripe_output(
    output_dir: Path,
    summary: dict[str, object],
    ufs: list[str],
    max_age_days: float = 21.0,
) -> None:
    source = summary.get("sources", {}).get("infogripe")
    if not isinstance(source, dict):
        raise RuntimeError("Missing InfoGripe source metadata")
    for field in [
        "source",
        "url",
        "repository",
        "retrieved_at_utc",
        "latest_week",
    ]:
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

        fields = [
            "infogripe_reported_raw",
            "infogripe_reported",
            "infogripe",
            "infogripe_lower80",
            "infogripe_upper80",
            "combined",
            "combined_lower80",
            "combined_upper80",
            "combined_envelope_lower",
            "combined_envelope_upper",
        ]
        if any(not _nonnegative_number(latest.get(field)) for field in fields):
            raise RuntimeError(f"Invalid latest InfoGripe values for {uf}")
        if not (
            latest["infogripe_lower80"]
            <= latest["infogripe"]
            <= latest["infogripe_upper80"]
        ):
            raise RuntimeError(f"Inverted InfoGripe interval for {uf}")
        if not (
            latest["combined_envelope_lower"]
            <= latest["combined_lower80"]
            <= latest["combined"]
            <= latest["combined_upper80"]
            <= latest["combined_envelope_upper"]
        ):
            raise RuntimeError(f"Invalid combined InfoGripe interval for {uf}")

        matching = [
            row
            for row in payload.get("series", [])
            if row.get("week") == latest["infogripe_week"]
        ]
        if (
            len(matching) != 1
            or matching[0].get("infogripe") != latest["infogripe"]
            or matching[0].get("combined") != latest["combined"]
        ):
            raise RuntimeError(f"InfoGripe latest/series mismatch for {uf}")

        score = payload.get("backtest", {}).get("combined")
        if not isinstance(score, dict) or score.get("note") is None:
            raise RuntimeError(f"Missing combined evaluation limitation for {uf}")
        mixture = payload.get("mixture", {})
        scale = mixture.get("infogripe_total_scale")
        if not _nonnegative_number(scale) or scale <= 0:
            raise RuntimeError(f"Invalid InfoGripe target scale for {uf}")
        local_weight = mixture.get("local_weight")
        infogripe_weight = mixture.get("infogripe_weight")
        if (
            not isinstance(local_weight, (int, float))
            or not isinstance(infogripe_weight, (int, float))
            or abs(local_weight + infogripe_weight - 1) > 1e-12
        ):
            raise RuntimeError(f"Invalid mixture weights for {uf}")
        if mixture.get("status") != "experimental_unscored":
            raise RuntimeError(f"Invalid InfoGripe mixture status for {uf}")
