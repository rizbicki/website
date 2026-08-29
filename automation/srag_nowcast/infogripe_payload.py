"""Attach published InfoGripe estimates to a dashboard locality payload."""

from __future__ import annotations

import math

import pandas as pd


def _number(value: object, digits: int = 3) -> float | int | None:
    if value is None or pd.isna(value):
        return None
    result = float(value)
    if not math.isfinite(result):
        return None
    if result.is_integer():
        return int(result)
    return round(result, digits)


def _rolling_change(values: list[float], window: int) -> float | None:
    if len(values) < 2 * window:
        return None
    recent = values[-window:]
    prior = values[-2 * window : -window]
    prior_sum = sum(prior)
    if prior_sum <= 0:
        return None
    return 100 * (sum(recent) / prior_sum - 1)


def attach_infogripe_payload(
    payload: dict[str, object],
    published: pd.DataFrame,
) -> None:
    """Add InfoGripe point/interval series without changing local nowcasts."""
    uf = str(payload["uf"])
    source = published.loc[published["uf"].eq(uf)].copy()
    if source.empty:
        raise RuntimeError(f"InfoGripe has no rows for {uf}")
    source["week"] = source["week_start"].dt.date.astype(str)
    by_week = source.set_index("week")

    rows = payload["series"]
    for row in rows:
        official = by_week.loc[row["week"]] if row["week"] in by_week.index else None
        row["infogripe_reported"] = (
            _number(official["reported"]) if official is not None else None
        )
        row["infogripe"] = _number(official["mean"]) if official is not None else None
        row["infogripe_lower80"] = (
            _number(official["lower80"]) if official is not None else None
        )
        row["infogripe_upper80"] = (
            _number(official["upper80"]) if official is not None else None
        )

    complete = [
        row
        for row in rows
        if row["infogripe"] is not None
        and row["infogripe_lower80"] is not None
        and row["infogripe_upper80"] is not None
        and row["infogripe_reported"] is not None
    ]
    if not complete:
        raise RuntimeError(f"InfoGripe has no complete displayed nowcast for {uf}")
    latest = complete[-1]
    expected_latest = source["week_start"].max().date().isoformat()
    if latest["week"] != expected_latest:
        raise RuntimeError(
            f"InfoGripe latest week {expected_latest} is outside {uf}'s display series"
        )

    values = [
        float(row["infogripe"])
        for row in rows
        if row["infogripe"] is not None and row["week"] <= latest["week"]
    ]
    payload["latest"].update(
        {
            "infogripe_week": latest["week"],
            "infogripe_reported": latest["infogripe_reported"],
            "infogripe": latest["infogripe"],
            "infogripe_lower80": latest["infogripe_lower80"],
            "infogripe_upper80": latest["infogripe_upper80"],
            "infogripe_change_2w_percent": _number(_rolling_change(values, 2)),
            "infogripe_change_4w_percent": _number(_rolling_change(values, 4)),
        }
    )
    payload["backtest"]["infogripe"] = {
        "n": None,
        "mae": None,
        "rmse": None,
        "wape_percent": None,
        "bias": None,
        "correlation": None,
        "coverage80_percent": None,
        "mean_interval_width": None,
        "note": (
            "O desempenho histórico requer vintages arquivados das previsões; "
            "o CSV público do InfoGripe é revisado continuamente."
        ),
    }
