"""Fetch and validate the official published InfoGripe nowcast series."""

from __future__ import annotations

import random
import time
from datetime import date, datetime, timedelta, timezone
from io import StringIO
from pathlib import Path

import pandas as pd
import requests


REQUIRED_COLUMNS = {
    "IC80I",
    "IC80S",
    "Casos semanais reportados até a última atualização",
    "casos estimados",
    "Semana epidemiológica",
    "Ano epidemiológico",
    "DS_UF_SIGLA",
    "escala",
}


def epiweek_start(year: int, week: int) -> pd.Timestamp:
    """Sunday starting a Brazilian/MMWR epidemiological week."""
    jan_fourth = date(int(year), 1, 4)
    first_sunday = jan_fourth - timedelta(days=(jan_fourth.weekday() + 1) % 7)
    next_jan_fourth = date(int(year) + 1, 1, 4)
    next_first = next_jan_fourth - timedelta(
        days=(next_jan_fourth.weekday() + 1) % 7
    )
    result = first_sunday + timedelta(weeks=int(week) - 1)
    if int(week) < 1 or result >= next_first:
        raise ValueError(f"Invalid epidemiological year/week: {year}/{week}")
    return pd.Timestamp(result)


def normalise_infogripe(
    raw: pd.DataFrame,
    expected_ufs: list[str],
) -> pd.DataFrame:
    """Map the official Portuguese CSV to one row per UF and epiweek."""
    missing = sorted(REQUIRED_COLUMNS - set(raw.columns))
    if missing:
        raise RuntimeError(f"InfoGripe CSV lacks columns: {missing}")

    frame = raw.loc[raw["escala"].astype(str).str.strip().eq("casos")].copy()
    frame["uf"] = frame["DS_UF_SIGLA"].astype(str).str.strip().str.upper()
    frame = frame.loc[frame["uf"].isin(expected_ufs)].copy()
    present = set(frame["uf"])
    if present != set(expected_ufs):
        raise RuntimeError(
            "InfoGripe CSV has an invalid geography set; missing="
            f"{sorted(set(expected_ufs) - present)}, "
            f"unexpected={sorted(present - set(expected_ufs))}"
        )

    frame["week_start"] = [
        epiweek_start(year, week)
        for year, week in zip(
            frame["Ano epidemiológico"], frame["Semana epidemiológica"]
        )
    ]
    result = frame.rename(
        columns={
            "Casos semanais reportados até a última atualização": "reported",
            "casos estimados": "mean",
            "IC80I": "lower80",
            "IC80S": "upper80",
        }
    )[["uf", "week_start", "reported", "mean", "lower80", "upper80"]]
    for column in ["reported", "mean", "lower80", "upper80"]:
        result[column] = pd.to_numeric(result[column], errors="coerce")
    if result[["uf", "week_start"]].duplicated().any():
        raise RuntimeError("Duplicate UF + epidemiological week in InfoGripe CSV")
    if result["mean"].isna().any() or (result["mean"] < 0).any():
        raise RuntimeError("InfoGripe CSV has invalid point estimates")
    complete = result[["lower80", "upper80"]].notna().all(axis=1)
    if (result.loc[complete, "lower80"] > result.loc[complete, "upper80"]).any():
        raise RuntimeError("InfoGripe CSV has inverted 80% intervals")
    return result.sort_values(["uf", "week_start"]).reset_index(drop=True)


def _download_text(url: str, max_retries: int, user_agent: str) -> str:
    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.get(
                url,
                headers={"User-Agent": user_agent},
                timeout=(20, 180),
            )
            response.raise_for_status()
            return response.text
        except requests.RequestException as exc:
            last_error = exc
            if attempt == max_retries:
                break
            delay = min(5 * 2 ** (attempt - 1), 60) + random.uniform(0, 2)
            time.sleep(delay)
    assert last_error is not None
    raise last_error


def load_infogripe_nowcasts(
    *,
    source_url: str,
    source_file: Path | None,
    max_retries: int,
    max_age_days: float,
    expected_ufs: list[str],
    user_agent: str,
    credit: str,
) -> tuple[pd.DataFrame, dict[str, object]]:
    """Load the current series and reject stale or incomplete publications."""
    if source_file is None:
        raw = pd.read_csv(
            StringIO(_download_text(source_url, max_retries, user_agent)),
            sep=";",
            decimal=",",
        )
    else:
        raw = pd.read_csv(source_file, sep=";", decimal=",")
    frame = normalise_infogripe(raw, expected_ufs)

    latest_by_uf = frame.groupby("uf")["week_start"].max()
    if latest_by_uf.nunique() != 1:
        raise RuntimeError(
            "InfoGripe geographies have different latest weeks: "
            f"{latest_by_uf.dt.date.to_dict()}"
        )
    latest_week = pd.Timestamp(latest_by_uf.iloc[0])
    latest = frame.loc[frame["week_start"].eq(latest_week)]
    if latest[["mean", "lower80", "upper80", "reported"]].isna().any().any():
        raise RuntimeError("InfoGripe latest week lacks estimates or 80% intervals")

    week_end = latest_week + pd.Timedelta(days=6)
    age_days = (datetime.now(timezone.utc).date() - week_end.date()).days
    if age_days < -7 or age_days > max_age_days:
        raise RuntimeError(
            f"InfoGripe latest week is {age_days} days old "
            f"(maximum {max_age_days:g})"
        )

    return frame, {
        "source": credit,
        "url": source_url,
        "repository": "https://github.com/infogripe/Boletim_InfoGripe",
        "retrieved_at_utc": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "latest_week": latest_week.date().isoformat(),
        "latest_week_age_days": age_days,
        "geographies": len(latest_by_uf),
        "interval": "80% credible interval published by InfoGripe",
        "note": (
            "Current-view reporting-delay nowcasts. Historical values are "
            "revised as notifications accumulate; weekly site commits preserve "
            "the values shown at each publication."
        ),
    }
