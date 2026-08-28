#!/usr/bin/env python3
"""Build the nationwide static SRAG nowcast data bundle.

The production model is state-specific. It trains on the latest 104 consolidated
weeks, uses same-week Google Trends for gripe, sintomas gripe, and tosse, and
combines a LASSO estimate with the observed value from 52 weeks earlier.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import shutil
import sys
import tempfile
import time
from collections import OrderedDict
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import requests
from sklearn.linear_model import Lasso
from sklearn.model_selection import GridSearchCV, TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


STATES = OrderedDict(
    [
        ("AC", ("Acre", "12")),
        ("AL", ("Alagoas", "27")),
        ("AP", ("Amapá", "16")),
        ("AM", ("Amazonas", "13")),
        ("BA", ("Bahia", "29")),
        ("CE", ("Ceará", "23")),
        ("DF", ("Distrito Federal", "53")),
        ("ES", ("Espírito Santo", "32")),
        ("GO", ("Goiás", "52")),
        ("MA", ("Maranhão", "21")),
        ("MT", ("Mato Grosso", "51")),
        ("MS", ("Mato Grosso do Sul", "50")),
        ("MG", ("Minas Gerais", "31")),
        ("PA", ("Pará", "15")),
        ("PB", ("Paraíba", "25")),
        ("PR", ("Paraná", "41")),
        ("PE", ("Pernambuco", "26")),
        ("PI", ("Piauí", "22")),
        ("RJ", ("Rio de Janeiro", "33")),
        ("RN", ("Rio Grande do Norte", "24")),
        ("RS", ("Rio Grande do Sul", "43")),
        ("RO", ("Rondônia", "11")),
        ("RR", ("Roraima", "14")),
        ("SC", ("Santa Catarina", "42")),
        ("SP", ("São Paulo", "35")),
        ("SE", ("Sergipe", "28")),
        ("TO", ("Tocantins", "17")),
    ]
)
TERMS = ["gripe", "sintomas gripe", "tosse"]
DATASET_URL = "https://dadosabertos.saude.gov.br/dataset/srag-2019-a-2026"
PROVISIONAL_LAG_DAYS = 42
TRAIN_WEEKS = 104
SEASONAL_WEIGHT = 0.5
SCHEMA_VERSION = 1
USER_AGENT = "rafaelizbicki-srag-nowcast/1.0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("static/dashboard/srag/data"),
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(".cache/sivep_gripe"),
    )
    parser.add_argument(
        "--trends-cache-dir",
        type=Path,
        default=Path(".cache/google_trends"),
    )
    parser.add_argument(
        "--collect-trends-only",
        action="store_true",
        help="Refresh the selected UF Trends checkpoints and stop.",
    )
    parser.add_argument(
        "--from-trends-cache",
        action="store_true",
        help="Build all models from previously collected UF checkpoints.",
    )
    parser.add_argument("--max-trends-age-days", type=float, default=9.0)
    parser.add_argument("--timeframe", default="today 5-y")
    parser.add_argument("--ufs", nargs="+", default=list(STATES))
    parser.add_argument("--trends-sleep", type=float, default=8.0)
    parser.add_argument("--max-retries", type=int, default=5)
    parser.add_argument(
        "--from-state-data",
        type=Path,
        help="Use existing data/states/<UF> inputs instead of downloading.",
    )
    parser.add_argument("--keep-weeks", type=int, default=156)
    parser.add_argument(
        "--validate-output",
        action="store_true",
        help="Only validate an existing output directory.",
    )
    return parser.parse_args()


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def number(value: object, digits: int = 3) -> float | int | None:
    if value is None or pd.isna(value):
        return None
    result = float(value)
    if not math.isfinite(result):
        return None
    if result.is_integer():
        return int(result)
    return round(result, digits)


def bool_value(value: object) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes"}
    return bool(value)


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        + "\n",
        encoding="utf-8",
    )


def retry_get(url: str, max_retries: int, stream: bool = False) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.get(
                url,
                headers={"User-Agent": USER_AGENT},
                timeout=(20, 180),
                stream=stream,
            )
            response.raise_for_status()
            return response
        except requests.RequestException as exc:
            last_error = exc
            if attempt == max_retries:
                break
            delay = min(5 * 2 ** (attempt - 1), 60) + random.uniform(0, 2)
            print(f"Request failed: {exc}; retrying in {delay:.1f}s", file=sys.stderr)
            time.sleep(delay)
    assert last_error is not None
    raise last_error


def trend_cache_paths(cache_dir: Path, uf: str) -> tuple[Path, Path]:
    return cache_dir / f"{uf}.csv", cache_dir / f"{uf}.json"


def save_trend_cache(
    cache_dir: Path,
    uf: str,
    timeframe: str,
    frame: pd.DataFrame,
    retrieved_at: str,
) -> None:
    csv_path, metadata_path = trend_cache_paths(cache_dir, uf)
    cache_dir.mkdir(parents=True, exist_ok=True)
    temporary_csv = csv_path.with_suffix(".csv.part")
    temporary_json = metadata_path.with_suffix(".json.part")
    frame.to_csv(temporary_csv, index=False, date_format="%Y-%m-%d")
    temporary_json.write_text(
        json.dumps(
            {
                "uf": uf,
                "terms": TERMS,
                "timeframe": timeframe,
                "retrieved_at_utc": retrieved_at,
                "row_count": len(frame),
            },
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )
    temporary_csv.replace(csv_path)
    temporary_json.replace(metadata_path)


def load_trend_cache(
    cache_dir: Path,
    uf: str,
    timeframe: str,
    max_age_hours: float,
) -> tuple[pd.DataFrame, str] | None:
    csv_path, metadata_path = trend_cache_paths(cache_dir, uf)
    if not csv_path.exists() or not metadata_path.exists():
        return None
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        retrieved = datetime.fromisoformat(str(metadata["retrieved_at_utc"]))
        age_hours = (now_utc() - retrieved).total_seconds() / 3600
        if (
            metadata.get("uf") != uf
            or metadata.get("terms") != TERMS
            or metadata.get("timeframe") != timeframe
            or age_hours > max_age_hours
        ):
            return None
        frame = pd.read_csv(csv_path, parse_dates=["week_start"])
        frame["is_partial"] = frame["is_partial"].map(bool_value)
        if len(frame) != int(metadata["row_count"]):
            return None
        if set(frame["keyword"].unique()) != set(TERMS):
            return None
        return frame, retrieved.isoformat()
    except (OSError, ValueError, KeyError, json.JSONDecodeError):
        return None


def load_all_trend_caches(
    cache_dir: Path,
    ufs: list[str],
    timeframe: str,
    max_age_days: float,
) -> tuple[dict[str, pd.DataFrame], dict[str, object]]:
    result: dict[str, pd.DataFrame] = {}
    retrievals: dict[str, str] = {}
    missing: list[str] = []
    for uf in ufs:
        cached = load_trend_cache(
            cache_dir, uf, timeframe, max_age_hours=max_age_days * 24
        )
        if cached is None:
            missing.append(uf)
        else:
            result[uf], retrievals[uf] = cached
    if missing:
        raise RuntimeError(
            "Missing or stale Google Trends checkpoints for: " + ", ".join(missing)
        )
    return result, {
        "source": "Google Trends via trendspy",
        "url": "https://trends.google.com/trends/",
        "retrieved_at_utc": max(retrievals.values()),
        "state_retrieved_at_utc": retrievals,
        "timeframe": timeframe,
        "terms": TERMS,
        "normalization": (
            "Each UF is a separate three-term request normalized from 0 to 100. "
            "Values are not absolute counts and are not comparable across UFs."
        ),
    }



def fetch_trends(
    ufs: list[str],
    timeframe: str,
    sleep_seconds: float,
    max_retries: int,
    cache_dir: Path,
    fresh_hours: float = 36.0,
) -> tuple[dict[str, pd.DataFrame], dict[str, object]]:
    from trendspy import Trends

    result: dict[str, pd.DataFrame] = {}
    retrievals: dict[str, str] = {}
    for index, uf in enumerate(ufs, start=1):
        cached = load_trend_cache(cache_dir, uf, timeframe, fresh_hours)
        if cached is not None:
            result[uf], retrievals[uf] = cached
            print(
                f"Trends [{index:02d}/{len(ufs):02d}] {uf} "
                "(fresh checkpoint)",
                flush=True,
            )
            continue

        print(f"Trends [{index:02d}/{len(ufs):02d}] {uf}", flush=True)
        last_error: Exception | None = None
        for attempt in range(1, max_retries + 1):
            try:
                client = Trends(
                    language="pt-BR",
                    tzs=180,
                    request_delay=4.0,
                    max_retries=3,
                )
                wide = client.interest_over_time(
                    TERMS,
                    timeframe=timeframe,
                    geo=f"BR-{uf}",
                    cat=0,
                    gprop="",
                )
                if wide.empty:
                    raise RuntimeError(f"Google Trends returned no data for {uf}")
                frame = wide.reset_index()
                frame = frame.rename(
                    columns={
                        frame.columns[0]: "week_start",
                        "date": "week_start",
                        "isPartial": "is_partial",
                    }
                )
                if "is_partial" not in frame:
                    frame["is_partial"] = False
                frame["week_start"] = pd.to_datetime(frame["week_start"])
                missing = sorted(set(TERMS) - set(frame.columns))
                if missing:
                    raise RuntimeError(
                        f"Google Trends response for {uf} lacks: {', '.join(missing)}"
                    )
                long = frame.melt(
                    id_vars=["week_start", "is_partial"],
                    value_vars=TERMS,
                    var_name="keyword",
                    value_name="interest",
                )
                long.insert(1, "uf", uf)
                long["is_partial"] = long["is_partial"].map(bool_value)
                retrieved_at = now_utc().isoformat()
                save_trend_cache(cache_dir, uf, timeframe, long, retrieved_at)
                result[uf] = long
                retrievals[uf] = retrieved_at
                break
            except Exception as exc:
                last_error = exc
                if attempt == max_retries:
                    raise
                delay = min(15 * 2 ** (attempt - 1), 120) + random.uniform(0, 4)
                print(
                    f"{uf}: Trends failed ({exc}); retrying in {delay:.1f}s",
                    file=sys.stderr,
                )
                time.sleep(delay)
        if uf not in result:
            assert last_error is not None
            raise last_error
        if index < len(ufs):
            time.sleep(sleep_seconds + random.uniform(0, 1.5))

    metadata = {
        "source": "Google Trends via trendspy",
        "url": "https://trends.google.com/trends/",
        "retrieved_at_utc": max(retrievals.values()),
        "state_retrieved_at_utc": retrievals,
        "timeframe": timeframe,
        "terms": TERMS,
        "normalization": (
            "Each UF is a separate three-term request normalized from 0 to 100. "
            "Values are not absolute counts and are not comparable across UFs."
        ),
    }
    return result, metadata


def load_existing_state_data(
    root: Path, ufs: list[str]
) -> tuple[
    dict[str, pd.DataFrame],
    dict[str, pd.DataFrame],
    dict[str, object],
    dict[str, object],
]:
    trends: dict[str, pd.DataFrame] = {}
    srag: dict[str, pd.DataFrame] = {}
    trend_retrievals: list[str] = []
    snapshot_dates: list[str] = []
    for uf in ufs:
        state_dir = root / uf
        trends[uf] = pd.read_csv(
            state_dir / "google_trends_week.csv", parse_dates=["week_start"]
        )
        trends[uf]["is_partial"] = trends[uf]["is_partial"].map(bool_value)
        srag[uf] = pd.read_csv(
            state_dir / "srag_week.csv", parse_dates=["week_start"]
        )
        srag[uf]["is_partial_week"] = srag[uf]["is_partial_week"].map(bool_value)
        trend_meta = json.loads(
            (state_dir / "google_trends_week.metadata.json").read_text(
                encoding="utf-8"
            )
        )
        srag_meta = json.loads(
            (state_dir / "srag_week.metadata.json").read_text(encoding="utf-8")
        )
        trend_retrievals.append(str(trend_meta["retrieved_at_utc"]))
        snapshot_dates.append(str(srag_meta["latest_source_snapshot_date"]))

    trend_metadata = {
        "source": "Google Trends via trendspy",
        "url": "https://trends.google.com/trends/",
        "retrieved_at_utc": max(trend_retrievals),
        "timeframe": "existing state snapshots",
        "terms": TERMS,
        "normalization": (
            "Each UF is a separate three-term request normalized from 0 to 100."
        ),
    }
    srag_metadata = {
        "source": "SIVEP-Gripe, Brazilian Ministry of Health",
        "url": DATASET_URL,
        "retrieved_at_utc": now_utc().isoformat(),
        "latest_source_snapshot_date": max(snapshot_dates),
    }
    return trends, srag, trend_metadata, srag_metadata


def snapshot_date(name: str) -> date | None:
    matches = re.findall(r"(\d{2})/(\d{2})/(\d{4})", name)
    if not matches:
        return None
    day, month, year = matches[-1]
    return date(int(year), int(month), int(day))


def discover_srag_resources(
    years: list[int], max_retries: int
) -> dict[int, dict[str, object]]:
    html = retry_get(DATASET_URL, max_retries).text
    match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
    )
    if not match:
        raise RuntimeError("Could not find OpenDataSUS resource metadata")
    resources = json.loads(match.group(1))["props"]["pageProps"]["resources"]
    selected: dict[int, dict[str, object]] = {}
    for resource in resources:
        name = str(resource.get("name", ""))
        year_match = re.match(r"^(20\d{2})-.*PARQUET$", name, re.IGNORECASE)
        url = str(resource.get("url", ""))
        if year_match and url.lower().endswith(".parquet"):
            year = int(year_match.group(1))
            if year in years:
                selected[year] = resource
    missing = sorted(set(years) - set(selected))
    if missing:
        raise RuntimeError(f"No SRAG Parquet found for years: {missing}")
    return selected


def cached_resource_path(cache_dir: Path, year: int, resource_name: str) -> Path:
    snap = snapshot_date(resource_name)
    suffix = snap.isoformat() if snap else "latest"
    return cache_dir / f"srag_{year}_{suffix}.parquet"


def download_resource(
    url: str, destination: Path, max_retries: int
) -> None:
    if destination.exists() and destination.stat().st_size > 1024:
        print(f"Using cached {destination}", flush=True)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".parquet.part")
    response = retry_get(url, max_retries, stream=True)
    try:
        with temporary.open("wb") as handle:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    handle.write(chunk)
        if temporary.stat().st_size <= 1024:
            raise RuntimeError(f"Downloaded SRAG file is unexpectedly small: {url}")
        temporary.replace(destination)
    finally:
        response.close()
        temporary.unlink(missing_ok=True)


def common_complete_period(
    trends: dict[str, pd.DataFrame],
) -> tuple[pd.Timestamp, pd.Timestamp]:
    starts: list[pd.Timestamp] = []
    ends: list[pd.Timestamp] = []
    for uf, frame in trends.items():
        complete = frame.loc[~frame["is_partial"].map(bool_value), "week_start"]
        if complete.empty:
            raise RuntimeError(f"No complete Google Trends week for {uf}")
        starts.append(pd.Timestamp(complete.min()))
        ends.append(pd.Timestamp(complete.max()))
    start = max(starts)
    end = min(ends)
    expected = set(pd.date_range(start, end, freq="7D"))
    for uf, frame in trends.items():
        complete = set(
            pd.to_datetime(
                frame.loc[~frame["is_partial"].map(bool_value), "week_start"]
            )
        )
        if not expected.issubset(complete):
            raise RuntimeError(f"Google Trends weeks are not complete for {uf}")
    return start, end


def fetch_srag_all(
    ufs: list[str],
    start: pd.Timestamp,
    end: pd.Timestamp,
    cache_dir: Path,
    max_retries: int,
) -> tuple[dict[str, pd.DataFrame], dict[str, object]]:
    years = list(range(start.year, end.year + 1))
    resources = discover_srag_resources(years, max_retries)
    frames: list[pd.DataFrame] = []
    resource_metadata: list[dict[str, object]] = []
    columns = ["NU_NOTIFIC", "DT_SIN_PRI", "SG_UF"]

    for year in years:
        resource = resources[year]
        path = cached_resource_path(cache_dir, year, str(resource["name"]))
        download_resource(str(resource["url"]), path, max_retries)
        parquet = pq.ParquetFile(path)
        missing = sorted(set(columns) - set(parquet.schema_arrow.names))
        if missing:
            raise RuntimeError(f"{path} lacks columns: {missing}")
        frame = pq.read_table(path, columns=columns).to_pandas()
        frame["DT_SIN_PRI"] = pd.to_datetime(frame["DT_SIN_PRI"], errors="coerce")
        frame = frame.loc[
            frame["SG_UF"].isin(ufs)
            & frame["DT_SIN_PRI"].between(start, end, inclusive="both")
        ].copy()
        frames.append(frame)
        snap = snapshot_date(str(resource["name"]))
        resource_metadata.append(
            {
                "year": year,
                "name": resource["name"],
                "url": resource["url"],
                "snapshot_date": snap.isoformat() if snap else None,
                "national_rows": parquet.metadata.num_rows,
                "selected_rows": len(frame),
            }
        )
        print(f"SRAG {year}: selected {len(frame):,} records", flush=True)

    records = pd.concat(frames, ignore_index=True)
    duplicate = records["NU_NOTIFIC"].notna() & records.duplicated(
        ["SG_UF", "NU_NOTIFIC", "DT_SIN_PRI"], keep=False
    )
    if duplicate.any():
        raise RuntimeError("Duplicate UF + notification + onset-date keys in SRAG")

    onset = records["DT_SIN_PRI"]
    records["week_start"] = onset - pd.to_timedelta(
        (onset.dt.dayofweek + 1) % 7, unit="D"
    )
    grouped = (
        records.groupby(["SG_UF", "week_start"]).size().rename("srag_cases")
    )
    calendar = pd.MultiIndex.from_product(
        [ufs, pd.date_range(start, end, freq="7D")],
        names=["uf", "week_start"],
    )
    weekly = grouped.reindex(calendar, fill_value=0).reset_index()
    latest_snapshot = max(
        date.fromisoformat(str(item["snapshot_date"]))
        for item in resource_metadata
        if item["snapshot_date"]
    )
    week_end = weekly["week_start"] + pd.Timedelta(days=6)
    weekly["reporting_lag_days_at_snapshot"] = (
        pd.Timestamp(latest_snapshot) - week_end
    ).dt.days
    weekly["is_partial_week"] = weekly["reporting_lag_days_at_snapshot"] < 0

    by_state = {
        uf: weekly.loc[weekly["uf"].eq(uf)].reset_index(drop=True) for uf in ufs
    }
    metadata = {
        "source": "SIVEP-Gripe, Brazilian Ministry of Health",
        "url": DATASET_URL,
        "retrieved_at_utc": now_utc().isoformat(),
        "latest_source_snapshot_date": latest_snapshot.isoformat(),
        "resources": resource_metadata,
    }
    return by_state, metadata


def model_pipeline(alpha: float | None = None) -> Pipeline:
    lasso = Lasso(max_iter=100_000, tol=1e-7)
    if alpha is not None:
        lasso.set_params(alpha=alpha)
    return Pipeline([("scale", StandardScaler()), ("lasso", lasso)])


def choose_alpha(train: pd.DataFrame) -> tuple[Pipeline, float, float]:
    search = GridSearchCV(
        model_pipeline(),
        {"lasso__alpha": np.logspace(-2, 4, 49)},
        scoring="neg_mean_absolute_error",
        cv=TimeSeriesSplit(n_splits=5),
        n_jobs=1,
        refit=True,
    )
    search.fit(train[TERMS], train["srag_cases"])
    return (
        search.best_estimator_,
        float(search.best_params_["lasso__alpha"]),
        float(-search.best_score_),
    )


def metrics(actual: pd.Series, predicted: pd.Series) -> dict[str, float | None]:
    actual_values = actual.to_numpy(dtype=float)
    predicted_values = predicted.to_numpy(dtype=float)
    error = predicted_values - actual_values
    denominator = float(np.abs(actual_values).sum())
    correlation = None
    if (
        len(actual_values) >= 2
        and np.std(actual_values) > 0
        and np.std(predicted_values) > 0
    ):
        correlation = float(np.corrcoef(actual_values, predicted_values)[0, 1])
    return {
        "n": int(len(actual_values)),
        "mae": number(np.abs(error).mean()),
        "rmse": number(np.sqrt(np.mean(error**2))),
        "wape_percent": number(
            100 * np.abs(error).sum() / denominator if denominator else None
        ),
        "bias": number(error.mean()),
        "correlation": number(correlation),
    }


MODEL_COLUMNS = {
    "ensemble": "ensemble",
    "lasso": "lasso",
    "seasonal": "seasonal_naive",
}


def backtest_fixed_alpha(
    train: pd.DataFrame, alpha: float
) -> tuple[
    pd.DataFrame,
    dict[str, dict[str, float | None]],
    dict[str, tuple[float, float]],
]:
    pieces: list[pd.DataFrame] = []
    splitter = TimeSeriesSplit(n_splits=5)
    for fit_index, test_index in splitter.split(train):
        fitted = model_pipeline(alpha)
        fitted.fit(train.iloc[fit_index][TERMS], train.iloc[fit_index]["srag_cases"])
        piece = train.iloc[test_index][
            ["week_start", "srag_cases", "seasonal_naive"]
        ].copy()
        piece["lasso"] = np.clip(
            fitted.predict(train.iloc[test_index][TERMS]), 0, None
        )
        piece = piece.loc[piece["seasonal_naive"].notna()].copy()
        piece["ensemble"] = (
            SEASONAL_WEIGHT * piece["lasso"]
            + (1 - SEASONAL_WEIGHT) * piece["seasonal_naive"]
        )
        pieces.append(piece)
    backtest = pd.concat(pieces, ignore_index=True)
    if len(backtest) < 20:
        raise RuntimeError("Not enough out-of-fold weeks for uncertainty calibration")
    intervals: dict[str, tuple[float, float]] = {}
    score: dict[str, dict[str, float | None]] = {}
    for name, column in MODEL_COLUMNS.items():
        residual = backtest["srag_cases"] - backtest[column]
        intervals[name] = (
            float(residual.quantile(0.10)),
            float(residual.quantile(0.90)),
        )
        score[name] = metrics(backtest["srag_cases"], backtest[column])
    return backtest, score, intervals


def prepare_state_frame(
    trends: pd.DataFrame, srag: pd.DataFrame
) -> pd.DataFrame:
    expected = set(TERMS)
    if set(trends["keyword"].unique()) != expected:
        raise RuntimeError(
            f"Unexpected Trends terms: {sorted(trends['keyword'].unique())}"
        )
    complete = trends.loc[~trends["is_partial"].map(bool_value)].copy()
    features = complete.pivot(
        index="week_start", columns="keyword", values="interest"
    ).reset_index()
    if features[TERMS].isna().any().any():
        raise RuntimeError("Missing term-week values in Google Trends")
    target_columns = [
        "week_start",
        "srag_cases",
        "reporting_lag_days_at_snapshot",
        "is_partial_week",
    ]
    data = features.merge(srag[target_columns], on="week_start", how="inner")
    data = data.sort_values("week_start").reset_index(drop=True)
    data["seasonal_week"] = data["week_start"] - pd.Timedelta(weeks=52)
    seasonal = data.set_index("week_start")["srag_cases"]
    data["seasonal_naive"] = data["seasonal_week"].map(seasonal)
    return data


def build_state_payload(
    uf: str,
    trends: pd.DataFrame,
    srag: pd.DataFrame,
    keep_weeks: int,
) -> tuple[dict[str, object], pd.DataFrame]:
    data = prepare_state_frame(trends, srag)
    reliable = (
        data["reporting_lag_days_at_snapshot"].ge(PROVISIONAL_LAG_DAYS)
        & ~data["is_partial_week"].map(bool_value)
    )
    if reliable.sum() < TRAIN_WEEKS:
        raise RuntimeError(f"{uf}: fewer than {TRAIN_WEEKS} consolidated weeks")
    cutoff = data.loc[reliable, "week_start"].max()
    train = data.loc[reliable & data["week_start"].le(cutoff)].tail(TRAIN_WEEKS)
    if len(train) != TRAIN_WEEKS:
        raise RuntimeError(f"{uf}: incomplete training window")
    target = data.loc[data["week_start"].gt(cutoff)].copy()
    if target.empty:
        raise RuntimeError(f"{uf}: no recent week available for nowcasting")
    if target["seasonal_naive"].isna().any():
        raise RuntimeError(f"{uf}: missing 52-week seasonal baseline")

    fitted, alpha, cv_mae = choose_alpha(train)
    target["lasso"] = np.clip(fitted.predict(target[TERMS]), 0, None)
    target["ensemble"] = (
        SEASONAL_WEIGHT * target["lasso"]
        + (1 - SEASONAL_WEIGHT) * target["seasonal_naive"]
    )
    backtest, score, intervals = backtest_fixed_alpha(train, alpha)
    target["lower80"] = np.clip(target["ensemble"] + intervals["ensemble"][0], 0, None)
    target["upper80"] = np.clip(target["ensemble"] + intervals["ensemble"][1], 0, None)
    target["lasso_lower80"] = np.clip(target["lasso"] + intervals["lasso"][0], 0, None)
    target["lasso_upper80"] = np.clip(target["lasso"] + intervals["lasso"][1], 0, None)
    target["seasonal_lower80"] = np.clip(
        target["seasonal_naive"] + intervals["seasonal"][0], 0, None
    )
    target["seasonal_upper80"] = np.clip(
        target["seasonal_naive"] + intervals["seasonal"][1], 0, None
    )

    target_by_week = target.set_index("week_start")
    display = data.tail(keep_weeks).copy()
    rows: list[dict[str, object]] = []
    for row in display.itertuples(index=False):
        production = (
            target_by_week.loc[row.week_start]
            if row.week_start in target_by_week.index
            else None
        )
        rows.append(
            {
                "week": row.week_start.date().isoformat(),
                "observed": number(row.srag_cases),
                "seasonal": number(row.seasonal_naive),
                "lasso": number(production["lasso"]) if production is not None else None,
                "nowcast": (
                    number(production["ensemble"]) if production is not None else None
                ),
                "lower80": (
                    number(production["lower80"]) if production is not None else None
                ),
                "upper80": (
                    number(production["upper80"]) if production is not None else None
                ),
                "lasso_lower80": (
                    number(production["lasso_lower80"])
                    if production is not None
                    else None
                ),
                "lasso_upper80": (
                    number(production["lasso_upper80"])
                    if production is not None
                    else None
                ),
                "seasonal_lower80": (
                    number(production["seasonal_lower80"])
                    if production is not None
                    else None
                ),
                "seasonal_upper80": (
                    number(production["seasonal_upper80"])
                    if production is not None
                    else None
                ),
                "provisional": bool(
                    row.reporting_lag_days_at_snapshot < PROVISIONAL_LAG_DAYS
                    or bool_value(row.is_partial_week)
                ),
                "reporting_lag_days": number(
                    row.reporting_lag_days_at_snapshot, digits=0
                ),
            }
        )

    latest = target.iloc[-1]
    state_name, ibge_code = STATES[uf]
    change = (
        100 * (latest["ensemble"] / latest["seasonal_naive"] - 1)
        if latest["seasonal_naive"] > 0
        else None
    )
    payload: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "uf": uf,
        "name": state_name,
        "ibge_code": ibge_code,
        "training": {
            "start": train["week_start"].min().date().isoformat(),
            "cutoff": cutoff.date().isoformat(),
            "weeks": TRAIN_WEEKS,
            "alpha": number(alpha, digits=6),
            "cv_mae": number(cv_mae),
            "terms": TERMS,
        },
        "backtest": score,
        "latest": {
            "week": latest["week_start"].date().isoformat(),
            "observed": number(latest["srag_cases"]),
            "lasso": number(latest["lasso"]),
            "seasonal": number(latest["seasonal_naive"]),
            "nowcast": number(latest["ensemble"]),
            "lower80": number(latest["lower80"]),
            "upper80": number(latest["upper80"]),
            "lasso_lower80": number(latest["lasso_lower80"]),
            "lasso_upper80": number(latest["lasso_upper80"]),
            "seasonal_lower80": number(latest["seasonal_lower80"]),
            "seasonal_upper80": number(latest["seasonal_upper80"]),
            "change_vs_seasonal_percent": number(change),
            "reporting_lag_days": number(
                latest["reporting_lag_days_at_snapshot"], digits=0
            ),
        },
        "series": rows,
    }
    return payload, backtest.assign(uf=uf)


def build_brazil_payload(
    state_payloads: dict[str, dict[str, object]],
    state_backtests: list[pd.DataFrame],
) -> dict[str, object]:
    rows: list[dict[str, object]] = []
    state_series = []
    for uf, payload in state_payloads.items():
        frame = pd.DataFrame(payload["series"])
        frame["uf"] = uf
        state_series.append(frame)
    combined = pd.concat(state_series, ignore_index=True)
    for week, group in combined.groupby("week", sort=True):
        nowcast_values = group["nowcast"].dropna()
        rows.append(
            {
                "week": week,
                "observed": number(group["observed"].sum()),
                "seasonal": (
                    number(group["seasonal"].sum())
                    if group["seasonal"].notna().all()
                    else None
                ),
                "lasso": (
                    number(group["lasso"].sum())
                    if len(nowcast_values) == len(state_payloads)
                    else None
                ),
                "nowcast": (
                    number(group["nowcast"].sum())
                    if len(nowcast_values) == len(state_payloads)
                    else None
                ),
                "lower80": (
                    number(group["lower80"].sum())
                    if group["lower80"].notna().all()
                    else None
                ),
                "upper80": (
                    number(group["upper80"].sum())
                    if group["upper80"].notna().all()
                    else None
                ),
                "lasso_lower80": (
                    number(group["lasso_lower80"].sum())
                    if group["lasso_lower80"].notna().all()
                    else None
                ),
                "lasso_upper80": (
                    number(group["lasso_upper80"].sum())
                    if group["lasso_upper80"].notna().all()
                    else None
                ),
                "seasonal_lower80": (
                    number(group["seasonal_lower80"].sum())
                    if group["seasonal_lower80"].notna().all()
                    else None
                ),
                "seasonal_upper80": (
                    number(group["seasonal_upper80"].sum())
                    if group["seasonal_upper80"].notna().all()
                    else None
                ),
                "provisional": bool(group["provisional"].any()),
                "reporting_lag_days": number(
                    group["reporting_lag_days"].min(), digits=0
                ),
            }
        )

    backtest = pd.concat(state_backtests, ignore_index=True)
    national_backtest = (
        backtest.groupby("week_start", as_index=False)[
            ["srag_cases", "lasso", "seasonal_naive", "ensemble"]
        ]
        .sum()
        .sort_values("week_start")
    )
    score = {
        "lasso": metrics(national_backtest["srag_cases"], national_backtest["lasso"]),
        "seasonal": metrics(
            national_backtest["srag_cases"], national_backtest["seasonal_naive"]
        ),
        "ensemble": metrics(
            national_backtest["srag_cases"], national_backtest["ensemble"]
        ),
    }
    latest_rows = [row for row in rows if row["nowcast"] is not None]
    if not latest_rows:
        raise RuntimeError("No common nationwide nowcast week")
    latest = latest_rows[-1]
    change = (
        100 * (latest["nowcast"] / latest["seasonal"] - 1)
        if latest["seasonal"]
        else None
    )
    latest = {
        **latest,
        "change_vs_seasonal_percent": number(change),
    }
    cutoffs = [payload["training"]["cutoff"] for payload in state_payloads.values()]
    starts = [payload["training"]["start"] for payload in state_payloads.values()]
    return {
        "schema_version": SCHEMA_VERSION,
        "uf": "BR",
        "name": "Brasil",
        "ibge_code": "BR",
        "training": {
            "start": min(starts),
            "cutoff": min(cutoffs),
            "weeks": TRAIN_WEEKS,
            "terms": TERMS,
            "note": "The Brazil point estimate is the sum of the 27 state nowcasts.",
        },
        "backtest": score,
        "latest": latest,
        "series": rows,
    }


def summary_entry(payload: dict[str, object]) -> dict[str, object]:
    return {
        "uf": payload["uf"],
        "name": payload["name"],
        "ibge_code": payload["ibge_code"],
        "latest": payload["latest"],
        "backtest": payload["backtest"],
        "training_cutoff": payload["training"]["cutoff"],
    }


def validate_output(output_dir: Path, expected_ufs: list[str] | None = None) -> None:
    summary_path = output_dir / "summary.json"
    if not summary_path.exists():
        raise RuntimeError(f"Missing {summary_path}")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if summary.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeError("Unexpected dashboard schema version")
    if summary.get("terms") != TERMS:
        raise RuntimeError("Unexpected dashboard Trends terms")
    state_entries = summary.get("states", [])
    ufs = [entry["uf"] for entry in state_entries]
    if expected_ufs is not None and ufs != expected_ufs:
        raise RuntimeError(f"Unexpected UF list: {ufs}")
    if len(set(ufs)) != len(ufs):
        raise RuntimeError("Duplicate UFs in dashboard summary")
    for uf in ["BR", *ufs]:
        path = output_dir / "states" / f"{uf}.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload["uf"] != uf:
            raise RuntimeError(f"UF mismatch in {path}")
        series = payload["series"]
        if len(series) < TRAIN_WEEKS:
            raise RuntimeError(f"Too few displayed weeks for {uf}")
        weeks = pd.to_datetime([row["week"] for row in series])
        if not weeks.is_monotonic_increasing or weeks.duplicated().any():
            raise RuntimeError(f"Invalid week order for {uf}")
        if not (weeks.to_series().diff().dropna() == pd.Timedelta(weeks=1)).all():
            raise RuntimeError(f"Non-weekly series for {uf}")
        nowcasts = [row["nowcast"] for row in series if row["nowcast"] is not None]
        if not nowcasts or any(value < 0 for value in nowcasts):
            raise RuntimeError(f"Invalid nowcasts for {uf}")
        latest = payload["latest"]
        if latest["week"] != [row for row in series if row["nowcast"] is not None][-1][
            "week"
        ]:
            raise RuntimeError(f"Latest week mismatch for {uf}")


def publish_staged(staging: Path, output_dir: Path) -> None:
    backup = output_dir.with_name(output_dir.name + ".previous")
    if backup.exists():
        shutil.rmtree(backup)
    if output_dir.exists():
        output_dir.rename(backup)
    try:
        staging.rename(output_dir)
    except Exception:
        if backup.exists() and not output_dir.exists():
            backup.rename(output_dir)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def main() -> int:
    args = parse_args()
    ufs = [uf.upper() for uf in args.ufs]
    unknown = sorted(set(ufs) - set(STATES))
    if unknown:
        raise ValueError(f"Unknown UFs: {unknown}")
    if args.validate_output:
        validate_output(args.output_dir, ufs)
        print(f"Validated {args.output_dir}")
        return 0

    selected_modes = sum(
        bool(value)
        for value in (
            args.collect_trends_only,
            args.from_trends_cache,
            args.from_state_data,
        )
    )
    if selected_modes > 1:
        raise ValueError(
            "--collect-trends-only, --from-trends-cache and --from-state-data "
            "are mutually exclusive"
        )

    if args.collect_trends_only:
        fetch_trends(
            ufs,
            args.timeframe,
            args.trends_sleep,
            args.max_retries,
            args.trends_cache_dir,
        )
        print(f"Updated {len(ufs)} Trends checkpoints in {args.trends_cache_dir}")
        return 0

    if args.from_state_data:
        trends, srag, trends_meta, srag_meta = load_existing_state_data(
            args.from_state_data, ufs
        )
    else:
        if args.from_trends_cache:
            trends, trends_meta = load_all_trend_caches(
                args.trends_cache_dir,
                ufs,
                args.timeframe,
                args.max_trends_age_days,
            )
        else:
            trends, trends_meta = fetch_trends(
                ufs,
                args.timeframe,
                args.trends_sleep,
                args.max_retries,
                args.trends_cache_dir,
            )
        start, end = common_complete_period(trends)
        print(f"Common complete Trends period: {start.date()} to {end.date()}")
        srag, srag_meta = fetch_srag_all(
            ufs, start, end, args.cache_dir, args.max_retries
        )

    state_payloads: dict[str, dict[str, object]] = {}
    backtests: list[pd.DataFrame] = []
    for index, uf in enumerate(ufs, start=1):
        print(f"Model [{index:02d}/{len(ufs):02d}] {uf}", flush=True)
        payload, backtest = build_state_payload(
            uf, trends[uf], srag[uf], args.keep_weeks
        )
        state_payloads[uf] = payload
        backtests.append(backtest)

    brazil = build_brazil_payload(state_payloads, backtests)
    output_parent = args.output_dir.parent
    output_parent.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(prefix=".srag-data-", dir=str(output_parent))
    )
    try:
        state_dir = staging / "states"
        state_dir.mkdir()
        for uf, payload in state_payloads.items():
            write_json(state_dir / f"{uf}.json", payload)
        write_json(state_dir / "BR.json", brazil)
        summary = {
            "schema_version": SCHEMA_VERSION,
            "generated_at_utc": now_utc().isoformat(),
            "terms": TERMS,
            "model": {
                "name": "50% LASSO + 50% seasonal lag-52 nowcast",
                "training_weeks": TRAIN_WEEKS,
                "consolidation_lag_days": PROVISIONAL_LAG_DAYS,
                "interval": (
                    "Empirical 80% band from time-series out-of-fold residuals. "
                    "The Brazil band is the sum of state bands and is approximate."
                ),
                "interpretation": (
                    "Same-week nowcast after Google Trends is observed; "
                    "not a forecast of future weeks."
                ),
            },
            "sources": {
                "google_trends": trends_meta,
                "srag": srag_meta,
            },
            "default_state": "BR",
            "brazil": summary_entry(brazil),
            "states": [summary_entry(state_payloads[uf]) for uf in ufs],
        }
        write_json(staging / "summary.json", summary)
        validate_output(staging, ufs)
        publish_staged(staging, args.output_dir)
    finally:
        if staging.exists():
            shutil.rmtree(staging)

    print(f"Published dashboard data to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
