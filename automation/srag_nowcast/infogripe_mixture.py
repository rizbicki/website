"""Harmonize InfoGripe with the dashboard target and mix both nowcasts."""

from __future__ import annotations

import math
from statistics import NormalDist

import pandas as pd


CENTRAL_INTERVAL = 0.80
LOCAL_WEIGHT = 0.50
TAIL = (1 - CENTRAL_INTERVAL) / 2
Z90 = NormalDist().inv_cdf(1 - TAIL)
NORMAL = NormalDist()
FIELDS = (
    "infogripe_reported_raw",
    "infogripe_raw",
    "infogripe_raw_lower80",
    "infogripe_raw_upper80",
    "infogripe_reported",
    "infogripe",
    "infogripe_lower80",
    "infogripe_upper80",
    "combined",
    "combined_lower80",
    "combined_upper80",
    "combined_envelope_lower",
    "combined_envelope_upper",
)
UNSCORED_MIXTURE = {
    "n": None,
    "mae": None,
    "rmse": None,
    "wape_percent": None,
    "bias": None,
    "correlation": None,
    "coverage80_percent": None,
    "mean_interval_width": None,
    "note": (
        "Not yet backtested: dated InfoGripe vintages are being accumulated "
        "before the 50/50 weight and interval coverage are evaluated."
    ),
}


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


def _component_cdf(
    value: float,
    prediction: tuple[float, float, float],
) -> float:
    mean, lower80, upper80 = prediction
    if value < 0:
        return 0.0
    log_value = math.log1p(value)
    log_center = math.log1p(mean)
    if value < mean:
        scale = max((log_center - math.log1p(lower80)) / Z90, 1e-12)
    else:
        scale = max((math.log1p(upper80) - log_center) / Z90, 1e-12)
    return NORMAL.cdf((log_value - log_center) / scale)


def _mixture_quantile(
    probability: float,
    local: tuple[float, float, float],
    official: tuple[float, float, float],
    local_weight: float,
) -> float:
    def cdf(value: float) -> float:
        return local_weight * _component_cdf(value, local) + (
            1 - local_weight
        ) * _component_cdf(value, official)

    if cdf(0.0) >= probability:
        return 0.0
    low = 0.0
    high = max(local[0], local[2], official[0], official[2], 1.0)
    while cdf(high) < probability:
        high = 2 * high + 1
    for _ in range(80):
        middle = (low + high) / 2
        if cdf(middle) < probability:
            low = middle
        else:
            high = middle
    return (low + high) / 2


def mix_predictions(
    local: tuple[float, float, float],
    official: tuple[float, float, float],
    local_weight: float = LOCAL_WEIGHT,
) -> dict[str, float]:
    """Linearly pool asymmetric distributions reconstructed on log1p scale."""
    if not math.isfinite(local_weight) or not 0 < local_weight < 1:
        raise ValueError("local_weight must be strictly between zero and one")
    for mean, lower80, upper80 in (local, official):
        if not all(math.isfinite(value) for value in (mean, lower80, upper80)):
            raise ValueError("Predictive triplet contains a non-finite value")
        if not 0 <= lower80 <= mean <= upper80:
            raise ValueError(
                "Predictive triplet must satisfy "
                "0 <= lower80 <= mean <= upper80"
            )
    return {
        "mean": local_weight * local[0] + (1 - local_weight) * official[0],
        "lower80": _mixture_quantile(TAIL, local, official, local_weight),
        "upper80": _mixture_quantile(1 - TAIL, local, official, local_weight),
        "envelope_lower": min(local[1], official[1]),
        "envelope_upper": max(local[2], official[2]),
    }


def attach_infogripe_mixture(
    payload: dict[str, object],
    published: pd.DataFrame,
) -> None:
    """Attach same-target InfoGripe estimates and the experimental mixture."""
    uf = str(payload["uf"])
    official = published.loc[published["uf"].eq(uf)].copy()
    if official.empty:
        raise RuntimeError(f"InfoGripe has no rows for {uf}")
    official["week"] = pd.to_datetime(
        official["week_start"]
    ).dt.date.astype(str)
    if official["week"].duplicated().any():
        raise RuntimeError(f"{uf}: duplicate InfoGripe week")

    official = official.dropna(subset=["mean", "lower80", "upper80"])
    if official.empty:
        raise RuntimeError(f"{uf}: InfoGripe has no complete 80% nowcast")
    source_latest_week = official["week"].max()

    series = payload["series"]
    first_week = pd.Timestamp(series[0]["week"])
    last_week = max(
        pd.Timestamp(series[-1]["week"]),
        pd.Timestamp(source_latest_week),
    )
    row_by_week = {row["week"]: row for row in series}
    for week in pd.date_range(first_week, last_week, freq="7D"):
        key = week.date().isoformat()
        if key not in row_by_week:
            row_by_week[key] = {
                "week": key,
                "observed": None,
                "observed_total": None,
                "infogripe_filtered_observed": None,
                "seasonal": None,
                "lasso": None,
                "nowcast": None,
                "lower80": None,
                "upper80": None,
                "lasso_lower80": None,
                "lasso_upper80": None,
                "seasonal_lower80": None,
                "seasonal_upper80": None,
                "provisional": True,
                "reporting_lag_days": None,
            }
    payload["series"] = [row_by_week[week] for week in sorted(row_by_week)]

    target_scale = 1.0
    by_week = official.set_index("week")
    for row in payload["series"]:
        row.update({field: None for field in FIELDS})
        if row["week"] not in by_week.index:
            continue
        source = by_week.loc[row["week"]]
        if pd.isna(source[["mean", "lower80", "upper80"]]).any():
            continue

        reported_raw = _number(source.get("reported"))
        info = (
            target_scale * float(source["mean"]),
            target_scale * float(source["lower80"]),
            target_scale * float(source["upper80"]),
        )
        row.update(
            {
                "infogripe_reported_raw": reported_raw,
                "infogripe_raw": _number(source["mean"]),
                "infogripe_raw_lower80": _number(source["lower80"]),
                "infogripe_raw_upper80": _number(source["upper80"]),
                "infogripe_reported": (
                    _number(target_scale * reported_raw)
                    if reported_raw is not None
                    else None
                ),
                "infogripe": _number(info[0]),
                "infogripe_lower80": _number(info[1]),
                "infogripe_upper80": _number(info[2]),
            }
        )
        if row.get("nowcast") is None:
            continue

        local = (
            float(row["nowcast"]),
            float(row["lower80"]),
            float(row["upper80"]),
        )
        mixed = mix_predictions(local, info)
        row.update(
            {
                "combined": _number(mixed["mean"]),
                "combined_lower80": _number(mixed["lower80"]),
                "combined_upper80": _number(mixed["upper80"]),
                "combined_envelope_lower": _number(
                    mixed["envelope_lower"]
                ),
                "combined_envelope_upper": _number(
                    mixed["envelope_upper"]
                ),
            }
        )

    infogripe_rows = [
        row for row in payload["series"] if row["infogripe_raw"] is not None
    ]
    combined_rows = [
        row for row in payload["series"] if row["combined"] is not None
    ]
    latest_info = infogripe_rows[-1]
    payload["latest"].update(
        {field: latest_info[field] for field in FIELDS[:8]}
    )
    payload["latest"]["infogripe_week"] = latest_info["week"]
    if combined_rows:
        latest_combined = combined_rows[-1]
        payload["latest"].update(
            {field: latest_combined[field] for field in FIELDS[8:]}
        )
        payload["latest"]["combined_week"] = latest_combined["week"]
    else:
        payload["latest"].update({field: None for field in FIELDS[8:]})
        payload["latest"]["combined_week"] = None

    raw_values = [
        float(row["infogripe_raw"])
        for row in payload["series"]
        if row["infogripe_raw"] is not None
    ]
    values = [
        float(row["infogripe"])
        for row in payload["series"]
        if row["infogripe"] is not None
    ]
    combined_values = [
        float(row["combined"])
        for row in payload["series"]
        if row["combined"] is not None
    ]
    payload["latest"]["infogripe_raw_change_2w_percent"] = _number(
        _rolling_change(raw_values, 2)
    )
    payload["latest"]["infogripe_raw_change_4w_percent"] = _number(
        _rolling_change(raw_values, 4)
    )
    payload["latest"]["infogripe_change_2w_percent"] = _number(
        _rolling_change(values, 2)
    )
    payload["latest"]["infogripe_change_4w_percent"] = _number(
        _rolling_change(values, 4)
    )
    payload["latest"]["combined_change_2w_percent"] = _number(
        _rolling_change(combined_values, 2)
    )
    payload["latest"]["combined_change_4w_percent"] = _number(
        _rolling_change(combined_values, 4)
    )
    payload["backtest"]["infogripe"] = dict(UNSCORED_MIXTURE)
    payload["backtest"]["combined"] = dict(UNSCORED_MIXTURE)
    payload["mixture"] = {
        "local_weight": LOCAL_WEIGHT,
        "infogripe_weight": 1 - LOCAL_WEIGHT,
        "infogripe_target_scale": _number(target_scale),
        "source_case_definition": (
            "(cough or sore throat) and (dyspnea or oxygen saturation below "
            "95% or respiratory distress) and (hospitalization or death)"
        ),
        "target_case_definition": "InfoGripe-compatible filtered SRAG cases",
        "scale": "log1p",
        "interval": "central 80% quantiles of the linear predictive pool",
        "envelope": "minimum lower and maximum upper component bounds",
        "status": "experimental_unscored",
    }
