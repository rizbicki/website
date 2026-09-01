#!/usr/bin/env python3
"""Build the nationwide static SRAG nowcast data bundle.

The production model is state-specific. It trains on the latest 104 consolidated
weeks, uses same-week Google Trends for gripe, sintomas gripe, and tosse, and
combines a LASSO estimate with a smoothed annual baseline at 52 +/- 2 weeks.
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
from datetime import date, datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from statistics import NormalDist

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
POPULATION = {
    "AC": 830_018,
    "AL": 3_127_683,
    "AP": 733_759,
    "AM": 3_941_613,
    "BA": 14_141_626,
    "CE": 8_794_957,
    "DF": 2_817_381,
    "ES": 3_833_712,
    "GO": 7_056_495,
    "MA": 6_776_699,
    "MT": 3_658_649,
    "MS": 2_757_013,
    "MG": 20_539_989,
    "PA": 8_120_131,
    "PB": 3_974_687,
    "PR": 11_444_380,
    "PE": 9_058_931,
    "PI": 3_271_199,
    "RJ": 16_055_174,
    "RN": 3_302_729,
    "RS": 10_882_965,
    "RO": 1_581_196,
    "RR": 636_707,
    "SC": 7_610_361,
    "SP": 44_411_238,
    "SE": 2_210_004,
    "TO": 1_511_460,
}
CENSUS_2022_TOTAL = 203_080_756
TERMS = ["gripe", "sintomas gripe", "tosse"]
DATASET_URL = "https://dadosabertos.saude.gov.br/dataset/srag-2019-a-2026"
PROVISIONAL_LAG_DAYS = 42
TRAIN_WEEKS = 104
SEASONAL_WEIGHT = 0.5
BACKTEST_ORIGIN_STEP = 4
BACKTEST_HORIZON_WEEKS = 7
SEASONAL_HALFWIDTH = 2
SCHEMA_VERSION = 1
USER_AGENT = "rafaelizbicki-srag-nowcast/1.0"
INFOGRIPE_NOWCAST_URL = (
    "https://raw.githubusercontent.com/infogripe/Boletim_InfoGripe/main/"
    "Dados/InfoGripe/"
    "estados_e_pais_serie_estimativas_tendencia_sem_filtro_febre.csv"
)
INFOGRIPE_FILTER_COLUMNS = [
    "TOSSE", "GARGANTA", "DISPNEIA", "SATURACAO", "DESC_RESP",
    "HOSPITAL", "EVOLUCAO",
]
MIXTURE_LOCAL_WEIGHT = 0.5
MIXTURE_TAIL = 0.10
INFOGRIPE_SCALE_WEEKS = 13
INFOGRIPE_MIN_SCALE_WEEKS = 8
NORMAL = NormalDist()
Z90 = NORMAL.inv_cdf(0.90)


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
    parser.add_argument(
        "--infogripe-file",
        type=Path,
        help="Use a pinned InfoGripe CSV instead of fetching its current view.",
    )
    parser.add_argument(
        "--skip-infogripe",
        action="store_true",
        help="Build without the experimental InfoGripe mixture.",
    )
    parser.add_argument(
        "--pin-local-sivep",
        action="store_true",
        help="Use only cached SIVEP Parquets and skip online discovery.",
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


def epiweek_start(year: int, week: int) -> pd.Timestamp:
    """Return the Sunday starting a Brazilian/MMWR epidemiological week."""
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


def normalise_infogripe(raw: pd.DataFrame) -> pd.DataFrame:
    required = {
        "IC80I",
        "IC80S",
        "Casos semanais reportados até a última atualização",
        "casos estimados",
        "Semana epidemiológica",
        "Ano epidemiológico",
        "DS_UF_SIGLA",
        "escala",
    }
    missing = sorted(required - set(raw.columns))
    if missing:
        raise RuntimeError(f"InfoGripe CSV lacks columns: {missing}")
    frame = raw.loc[raw["escala"].astype(str).str.strip().eq("casos")].copy()
    frame["uf"] = frame["DS_UF_SIGLA"].astype(str).str.strip().str.upper()
    frame = frame.loc[frame["uf"].isin(set(STATES) | {"BR"})].copy()
    frame["week_start"] = [
        epiweek_start(year, week)
        for year, week in zip(
            frame["Ano epidemiológico"], frame["Semana epidemiológica"]
        )
    ]
    frame = frame.rename(
        columns={
            "Casos semanais reportados até a última atualização": "reported",
            "casos estimados": "mean",
            "IC80I": "lower80",
            "IC80S": "upper80",
        }
    )[["uf", "week_start", "reported", "mean", "lower80", "upper80"]]
    for column in ["reported", "mean", "lower80", "upper80"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    if frame[["uf", "week_start"]].duplicated().any():
        raise RuntimeError("Duplicate UF + week in InfoGripe CSV")
    if frame["mean"].isna().any() or (frame["mean"] < 0).any():
        raise RuntimeError("InfoGripe CSV has invalid point estimates")
    complete = frame[["lower80", "upper80"]].notna().all(axis=1)
    invalid = (
        (frame.loc[complete, "lower80"] < 0)
        | (frame.loc[complete, "lower80"] > frame.loc[complete, "mean"])
        | (frame.loc[complete, "mean"] > frame.loc[complete, "upper80"])
    )
    if invalid.any():
        raise RuntimeError("InfoGripe CSV has invalid 80% intervals")
    return frame.sort_values(["uf", "week_start"]).reset_index(drop=True)


def load_infogripe(
    path: Path | None, max_retries: int
) -> tuple[pd.DataFrame, dict[str, object]]:
    retrieved_at = now_utc().isoformat()
    source_name = "InfoGripe (MAVE/Fiocruz and GT-Influenza/MS)"
    if path is None:
        response = retry_get(INFOGRIPE_NOWCAST_URL, max_retries)
        raw = pd.read_csv(StringIO(response.text), sep=";", decimal=",")
        source_url = INFOGRIPE_NOWCAST_URL
    else:
        comma = pd.read_csv(path)
        normalized = ["uf", "week_start", "reported", "mean", "lower80", "upper80"]
        if set(normalized).issubset(comma.columns):
            frame = comma[normalized].copy()
            frame["week_start"] = pd.to_datetime(frame["week_start"]).astype("datetime64[s]")
            frame["uf"] = frame["uf"].astype(str).str.upper()
            complete = frame[["lower80", "upper80"]].notna().all(axis=1)
            invalid = (
                frame["mean"].isna()
                | (frame["mean"] < 0)
                | (complete & (frame["lower80"] < 0))
                | (complete & (frame["lower80"] > frame["mean"]))
                | (complete & (frame["mean"] > frame["upper80"]))
            )
            if invalid.any() or frame[["uf", "week_start"]].duplicated().any():
                raise RuntimeError("Archived InfoGripe CSV has invalid predictions")
            frame = frame.sort_values(["uf", "week_start"]).reset_index(drop=True)
            raw = None
        else:
            raw = pd.read_csv(path, sep=";", decimal=",")
        manifest_path = path.parent / "manifest.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            source_name = str(manifest.get("source", source_name))
            source_url = manifest.get("source_url")
            retrieved_at = str(manifest.get("retrieved_at_utc", retrieved_at))
        else:
            source_url = None
    if raw is not None:
        frame = normalise_infogripe(raw)
    return frame, {
        "source": source_name,
        "url": source_url,
        "retrieved_at_utc": retrieved_at,
        "rows": len(frame),
        "first_week": frame["week_start"].min().date().isoformat(),
        "last_week": frame["week_start"].max().date().isoformat(),
        "note": (
            "Current-view estimates are revised in place; dated weekly snapshots "
            "are archived separately before weights are learned."
        ),
    }


def component_cdf(
    value: float, mean: float, lower80: float, upper80: float
) -> float:
    if value < 0:
        return 0.0
    log_value = math.log1p(value)
    log_center = math.log1p(mean)
    if value < mean:
        scale = max((log_center - math.log1p(lower80)) / Z90, 1e-12)
    else:
        scale = max((math.log1p(upper80) - log_center) / Z90, 1e-12)
    return NORMAL.cdf((log_value - log_center) / scale)


def mixture_quantile(
    probability: float,
    local: tuple[float, float, float],
    official: tuple[float, float, float],
) -> float:
    def cdf(value: float) -> float:
        return MIXTURE_LOCAL_WEIGHT * component_cdf(value, *local) + (
            1 - MIXTURE_LOCAL_WEIGHT
        ) * component_cdf(value, *official)

    if cdf(0) >= probability:
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
) -> dict[str, float]:
    for mean, lower, upper in (local, official):
        if not 0 <= lower <= mean <= upper:
            raise RuntimeError("Invalid component interval for predictive mixture")
    return {
        "mean": MIXTURE_LOCAL_WEIGHT * local[0]
        + (1 - MIXTURE_LOCAL_WEIGHT) * official[0],
        "lower80": mixture_quantile(MIXTURE_TAIL, local, official),
        "upper80": mixture_quantile(1 - MIXTURE_TAIL, local, official),
        "envelope_lower": min(local[1], official[1]),
        "envelope_upper": max(local[2], official[2]),
    }


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
                frame["week_start"] = pd.to_datetime(frame["week_start"]).astype("datetime64[s]")
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


def local_srag_resources(cache_dir: Path) -> dict[int, dict[str, object]]:
    """Reconstruct immutable resource records from cached SIVEP Parquets."""
    resources: dict[int, dict[str, object]] = {}
    for path in sorted(cache_dir.glob("srag_*_*.parquet")):
        match = re.fullmatch(r"srag_(20\d{2})_(\d{4}-\d{2}-\d{2})", path.stem)
        if not match:
            continue
        year = int(match.group(1))
        snapshot = date.fromisoformat(match.group(2))
        resources[year] = {
            "name": (
                f"{year}-SRAG hospitalizado "
                f"{snapshot.strftime('%d/%m/%Y')} PARQUET"
            ),
            "url": path.resolve().as_uri(),
        }
    if not resources:
        raise RuntimeError(f"No cached SIVEP Parquet files in {cache_dir}")
    return resources


def infogripe_case_mask(records: pd.DataFrame) -> pd.Series:
    """Select the symptom-filtered case definition used by InfoGripe."""
    missing = sorted(set(INFOGRIPE_FILTER_COLUMNS) - set(records.columns))
    if missing:
        raise RuntimeError(f"SIVEP data lacks InfoGripe filter columns: {missing}")
    coded = records[INFOGRIPE_FILTER_COLUMNS].astype("string")
    upper_respiratory = coded["TOSSE"].eq("1") | coded["GARGANTA"].eq("1")
    severe_respiratory = (
        coded["DISPNEIA"].eq("1")
        | coded["SATURACAO"].eq("1")
        | coded["DESC_RESP"].eq("1")
    )
    hospitalized_or_dead = coded["HOSPITAL"].eq("1") | coded["EVOLUCAO"].isin(
        ["2", "3"]
    )
    return (
        upper_respiratory & severe_respiratory & hospitalized_or_dead
    ).fillna(False)


def fetch_srag_all(
    ufs: list[str],
    start: pd.Timestamp,
    end: pd.Timestamp,
    cache_dir: Path,
    max_retries: int,
    resources: dict[int, dict[str, object]] | None = None,
) -> tuple[dict[str, pd.DataFrame], dict[str, object]]:
    years = list(range(start.year, end.year + 1))
    if resources is None:
        resources = discover_srag_resources(years, max_retries)
    missing = sorted(set(years) - set(resources))
    if missing:
        raise RuntimeError(f"No SRAG resource for years: {missing}")
    frames: list[pd.DataFrame] = []
    resource_metadata: list[dict[str, object]] = []
    columns = [
        "NU_NOTIFIC", "DT_SIN_PRI", "SG_UF", *INFOGRIPE_FILTER_COLUMNS
    ]

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
    records["infogripe_filtered"] = infogripe_case_mask(records)
    grouped = records.groupby(["SG_UF", "week_start"]).agg(
        srag_cases=("NU_NOTIFIC", "size"),
        infogripe_filtered_cases=("infogripe_filtered", "sum"),
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
        "infogripe_filter": (
            "(TOSSE = 1 or GARGANTA = 1) and "
            "(DISPNEIA = 1 or SATURACAO = 1 or DESC_RESP = 1) and "
            "(HOSPITAL = 1 or EVOLUCAO in {2, 3})"
        ),
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


def rolling_change_percent(values: list[float | None], window: int) -> float | None:
    if len(values) < 2 * window:
        return None
    recent = values[-window:]
    prior = values[-2 * window : -window]
    if any(v is None for v in recent) or any(v is None for v in prior):
        return None
    prior_sum = sum(prior)
    if prior_sum <= 0:
        return None
    return 100 * (sum(recent) / prior_sum - 1)


def recent_change_metrics(rows: list[dict[str, object]]) -> dict[str, float | None]:
    values = [
        row["nowcast"] if row["nowcast"] is not None else row["observed"]
        for row in rows
    ]
    return {
        "change_2w_percent": number(rolling_change_percent(values, 2)),
        "change_4w_percent": number(rolling_change_percent(values, 4)),
    }


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
        lower = np.clip(backtest[column] + intervals[name][0], 0, None)
        upper = np.clip(backtest[column] + intervals[name][1], 0, None)
        score[name].update(
            {
                "coverage80_percent": number(
                    100
                    * np.mean(
                        (backtest["srag_cases"] >= lower)
                        & (backtest["srag_cases"] <= upper)
                    )
                ),
                "mean_interval_width": number((upper - lower).mean()),
            }
        )
    return backtest, score, intervals


def rolling_origin_backtest(
    history: pd.DataFrame,
    train_weeks: int = TRAIN_WEEKS,
    origin_step: int = BACKTEST_ORIGIN_STEP,
    horizon_weeks: int = BACKTEST_HORIZON_WEEKS,
) -> tuple[pd.DataFrame, dict[str, dict[str, object]]]:
    """Score each of the seven production horizons at independent origins."""
    ordered = history.sort_values("week_start").reset_index(drop=True).copy()
    if len(ordered) <= train_weeks:
        raise RuntimeError(
            f"Need more than {train_weeks} consolidated weeks for backtesting"
        )
    if origin_step < 1 or horizon_weeks < 1:
        raise ValueError("Backtest spacing and horizon must be positive")

    pieces: list[pd.DataFrame] = []
    for origin_index in range(train_weeks, len(ordered), origin_step):
        window = ordered.iloc[origin_index - train_weeks : origin_index].copy()
        target = ordered.iloc[
            origin_index : min(origin_index + horizon_weeks, len(ordered))
        ].copy()
        target["horizon_week"] = np.arange(1, len(target) + 1)
        fitted, alpha, _ = choose_alpha(window)
        _, _, intervals = backtest_fixed_alpha(window, alpha)
        target["lasso"] = np.clip(fitted.predict(target[TERMS]), 0, None)
        target = target.loc[target["seasonal_naive"].notna()].copy()
        if target.empty:
            continue
        target["ensemble"] = (
            SEASONAL_WEIGHT * target["lasso"]
            + (1 - SEASONAL_WEIGHT) * target["seasonal_naive"]
        )
        for name, column in MODEL_COLUMNS.items():
            low, high = intervals[name]
            target[f"{column}_lower80"] = np.clip(target[column] + low, 0, None)
            target[f"{column}_upper80"] = np.clip(target[column] + high, 0, None)
        target["origin"] = ordered.iloc[origin_index]["week_start"]
        target["train_start"] = window["week_start"].min()
        target["train_end"] = window["week_start"].max()
        pieces.append(target)

    if not pieces:
        raise RuntimeError("No valid rolling-origin predictions were produced")
    backtest = pd.concat(pieces, ignore_index=True)

    def score_frame(frame: pd.DataFrame, column: str) -> dict[str, object]:
        lower = frame[f"{column}_lower80"]
        upper = frame[f"{column}_upper80"]
        values: dict[str, object] = metrics(frame["srag_cases"], frame[column])
        values.update(
            {
                "coverage80_percent": number(
                    100
                    * np.mean(
                        (frame["srag_cases"] >= lower)
                        & (frame["srag_cases"] <= upper)
                    )
                ),
                "mean_interval_width": number((upper - lower).mean()),
            }
        )
        return values

    score: dict[str, dict[str, object]] = {}
    for name, column in MODEL_COLUMNS.items():
        score[name] = score_frame(backtest, column)
        score[name]["by_horizon"] = {
            str(horizon): score_frame(frame, column)
            for horizon, frame in backtest.groupby("horizon_week", sort=True)
        }
        score[name].update(
            {
                "evaluation_origins": int(backtest["origin"].nunique()),
                "evaluation_predictions": int(len(backtest)),
                "origin_step_weeks": int(origin_step),
                "max_horizon_weeks": int(horizon_weeks),
                "note": (
                    "Rolling-origin evaluation with a 104-week training window. "
                    "Aggregate metrics pool all origin-horizon predictions."
                ),
            }
        )
    return backtest, score


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
        "infogripe_filtered_cases",
        "reporting_lag_days_at_snapshot",
        "is_partial_week",
    ]
    data = features.merge(srag[target_columns], on="week_start", how="inner")
    data = data.sort_values("week_start").reset_index(drop=True)
    seasonal = data.set_index("week_start")["srag_cases"]
    seasonal_values = []
    for shift in range(-SEASONAL_HALFWIDTH, SEASONAL_HALFWIDTH + 1):
        seasonal_week = data["week_start"] - pd.Timedelta(
            weeks=52 - shift
        )
        seasonal_values.append(seasonal_week.map(seasonal))
    data["seasonal_naive"] = pd.concat(seasonal_values, axis=1).mean(
        axis=1, skipna=True
    )
    return data


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


def estimate_infogripe_total_scale(
    rows: list[dict[str, object]],
    window_weeks: int = INFOGRIPE_SCALE_WEEKS,
    min_weeks: int = INFOGRIPE_MIN_SCALE_WEEKS,
) -> float:
    """Map the symptom-filtered InfoGripe series to the dashboard target."""
    if window_weeks < 1 or min_weeks < 1 or min_weeks > window_weeks:
        raise ValueError("Invalid InfoGripe scale window")
    overlap = pd.DataFrame(
        {
            "week": [row["week"] for row in rows],
            "total": [row["observed"] for row in rows],
            "filtered": [
                row.get("infogripe_filtered_observed") for row in rows
            ],
            "provisional": [row["provisional"] for row in rows],
        }
    )
    overlap["week"] = pd.to_datetime(overlap["week"])
    overlap["total"] = pd.to_numeric(overlap["total"], errors="coerce")
    overlap["filtered"] = pd.to_numeric(overlap["filtered"], errors="coerce")
    overlap = overlap.loc[
        ~overlap["provisional"].map(bool_value)
        & overlap["total"].notna()
        & overlap["filtered"].notna()
        & overlap["total"].ge(0)
        & overlap["filtered"].ge(0)
    ].sort_values("week")
    overlap = overlap.tail(window_weeks)
    if len(overlap) < min_weeks:
        raise RuntimeError(
            "InfoGripe scale has fewer than "
            f"{min_weeks} consolidated SIVEP weeks"
        )
    denominator = float(overlap["filtered"].sum())
    if denominator <= 0:
        raise RuntimeError("InfoGripe scale has no filtered cases in its window")
    scale = float(overlap["total"].sum()) / denominator
    if not np.isfinite(scale) or scale <= 0:
        raise RuntimeError("InfoGripe scale is not positive and finite")
    return scale


def attach_infogripe_mixture(
    payload: dict[str, object], published: pd.DataFrame
) -> None:
    uf = str(payload["uf"])
    official = published.loc[published["uf"].eq(uf)].copy()
    official["week"] = pd.to_datetime(official["week_start"]).dt.date.astype(str)
    if official["week"].duplicated().any():
        raise RuntimeError(f"{uf}: duplicate InfoGripe week")
    total_scale = estimate_infogripe_total_scale(payload["series"])
    by_week = official.set_index("week")
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
    for row in payload["series"]:
        for field in fields:
            row[field] = None
        if row["nowcast"] is None or row["week"] not in by_week.index:
            continue
        source = by_week.loc[row["week"]]
        if pd.isna(source[["mean", "lower80", "upper80"]]).any():
            continue
        local = (float(row["nowcast"]), float(row["lower80"]), float(row["upper80"]))
        info = (
            total_scale * float(source["mean"]),
            total_scale * float(source["lower80"]),
            total_scale * float(source["upper80"]),
        )
        mixed = mix_predictions(local, info)
        row.update(
            {
                "infogripe_reported_raw": number(source.get("reported")),
                "infogripe_reported": number(
                    total_scale * float(source["reported"])
                ),
                "infogripe": number(info[0]),
                "infogripe_lower80": number(info[1]),
                "infogripe_upper80": number(info[2]),
                "combined": number(mixed["mean"]),
                "combined_lower80": number(mixed["lower80"]),
                "combined_upper80": number(mixed["upper80"]),
                "combined_envelope_lower": number(mixed["envelope_lower"]),
                "combined_envelope_upper": number(mixed["envelope_upper"]),
            }
        )
    latest_row = next(
        row for row in payload["series"] if row["week"] == payload["latest"]["week"]
    )
    payload["latest"].update({field: latest_row[field] for field in fields})
    if payload["latest"]["combined"] is None:
        raise RuntimeError(
            f"{uf}: InfoGripe has no complete nowcast for the dashboard's latest week"
        )
    payload["backtest"]["combined"] = dict(UNSCORED_MIXTURE)
    payload["mixture"] = {
        "local_weight": MIXTURE_LOCAL_WEIGHT,
        "infogripe_weight": 1 - MIXTURE_LOCAL_WEIGHT,
        "infogripe_total_scale": number(total_scale),
        "scale_window_weeks": INFOGRIPE_SCALE_WEEKS,
        "source_case_definition": (
            "(cough or sore throat) and (dyspnea or oxygen saturation below "
            "95% or respiratory distress) and (hospitalization or death)"
        ),
        "target_case_definition": "all dashboard SIVEP-Gripe records",
        "scale": "log1p",
        "interval": "central 80% quantiles of the linear predictive pool",
        "envelope": "minimum lower and maximum upper component bounds",
        "status": "experimental_unscored",
    }


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
    reliable_history = data.loc[
        reliable & data["week_start"].le(cutoff)
    ].copy()
    train = reliable_history.tail(TRAIN_WEEKS)
    if len(train) != TRAIN_WEEKS:
        raise RuntimeError(f"{uf}: incomplete training window")
    target = data.loc[data["week_start"].gt(cutoff)].copy()
    if target.empty:
        raise RuntimeError(f"{uf}: no recent week available for nowcasting")
    if target["seasonal_naive"].isna().any():
        raise RuntimeError(f"{uf}: missing smoothed annual baseline")

    fitted, alpha, cv_mae = choose_alpha(train)
    target["lasso"] = np.clip(fitted.predict(target[TERMS]), 0, None)
    target["ensemble"] = (
        SEASONAL_WEIGHT * target["lasso"]
        + (1 - SEASONAL_WEIGHT) * target["seasonal_naive"]
    )
    _, _, intervals = backtest_fixed_alpha(train, alpha)
    backtest, score = rolling_origin_backtest(reliable_history, TRAIN_WEEKS)
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
                "infogripe_filtered_observed": number(
                    row.infogripe_filtered_cases
                ),
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
    recent_changes = recent_change_metrics(rows)
    payload: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "uf": uf,
        "name": state_name,
        "ibge_code": ibge_code,
        "population": POPULATION[uf],
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
            "infogripe_filtered_observed": number(
                latest["infogripe_filtered_cases"]
            ),
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
            **recent_changes,
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
    backtest_pieces: list[pd.DataFrame] = []
    identity_columns = ["origin", "horizon_week", "week_start"]
    value_columns = [
        "srag_cases",
        "lasso",
        "seasonal_naive",
        "ensemble",
    ]
    for state_index, state_backtest in enumerate(state_backtests):
        if state_backtest.duplicated(["origin", "horizon_week"]).any():
            raise RuntimeError("Duplicate state backtest origin/horizon")
        piece = state_backtest[identity_columns + value_columns].copy()
        piece["state_index"] = state_index
        backtest_pieces.append(piece)
    backtest = pd.concat(backtest_pieces, ignore_index=True)
    state_count = len(state_backtests)
    complete = (
        backtest.groupby(identity_columns)["state_index"]
        .nunique()
        .eq(state_count)
        .rename("complete")
        .reset_index()
    )
    national_backtest = (
        backtest.merge(complete.loc[complete["complete"]], on=identity_columns)
        .groupby(identity_columns, as_index=False)[value_columns]
        .sum(min_count=state_count)
        .dropna()
        .sort_values(identity_columns)
        .reset_index(drop=True)
    )
    if national_backtest.empty:
        raise RuntimeError("No common nationwide backtest prediction")

    model_columns = {
        "lasso": "lasso",
        "seasonal": "seasonal_naive",
        "ensemble": "ensemble",
    }
    national_intervals: dict[str, tuple[float, float]] = {}
    for name, column in model_columns.items():
        residual = national_backtest["srag_cases"] - national_backtest[column]
        national_intervals[name] = (
            float(residual.quantile(0.10)),
            float(residual.quantile(0.90)),
        )

    rows: list[dict[str, object]] = []
    state_series = []
    for uf, payload in state_payloads.items():
        frame = pd.DataFrame(payload["series"])
        frame["uf"] = uf
        state_series.append(frame)
    combined = pd.concat(state_series, ignore_index=True)
    for week, group in combined.groupby("week", sort=True):
        nowcast_values = group["nowcast"].dropna()
        all_states_nowcast = len(nowcast_values) == len(state_payloads)
        lasso = group["lasso"].sum() if all_states_nowcast else None
        nowcast = group["nowcast"].sum() if all_states_nowcast else None
        seasonal = (
            group["seasonal"].sum() if group["seasonal"].notna().all() else None
        )

        def interval_bound(
            point: float | None,
            state_bound: str,
            model: str,
            bound_index: int,
        ) -> float | int | None:
            if point is None or not group[state_bound].notna().all():
                return None
            return number(max(point + national_intervals[model][bound_index], 0))

        rows.append(
            {
                "week": week,
                "observed": number(group["observed"].sum()),
                "infogripe_filtered_observed": number(
                    group["infogripe_filtered_observed"].sum()
                ),
                "seasonal": number(seasonal),
                "lasso": number(lasso),
                "nowcast": number(nowcast),
                "lower80": interval_bound(nowcast, "lower80", "ensemble", 0),
                "upper80": interval_bound(nowcast, "upper80", "ensemble", 1),
                "lasso_lower80": interval_bound(
                    lasso, "lasso_lower80", "lasso", 0
                ),
                "lasso_upper80": interval_bound(
                    lasso, "lasso_upper80", "lasso", 1
                ),
                "seasonal_lower80": interval_bound(
                    seasonal, "seasonal_lower80", "seasonal", 0
                ),
                "seasonal_upper80": interval_bound(
                    seasonal, "seasonal_upper80", "seasonal", 1
                ),
                "provisional": bool(group["provisional"].any()),
                "reporting_lag_days": number(
                    group["reporting_lag_days"].min(), digits=0
                ),
            }
        )

    origins = pd.Index(sorted(national_backtest["origin"].unique()))
    calibration_origin_count = min(20, max(1, len(origins) // 2))
    evaluation_origins = set(origins[calibration_origin_count:])

    def national_score(frame: pd.DataFrame, column: str) -> dict[str, object]:
        values: dict[str, object] = metrics(frame["srag_cases"], frame[column])
        actual: list[float] = []
        lower: list[float] = []
        upper: list[float] = []
        all_residual = national_backtest["srag_cases"] - national_backtest[column]
        for row in frame.sort_values(identity_columns).itertuples(index=False):
            if row.origin not in evaluation_origins:
                continue
            prior = all_residual.loc[national_backtest["week_start"].lt(row.origin)]
            if prior.empty:
                continue
            point = float(getattr(row, column))
            actual.append(float(row.srag_cases))
            lower.append(max(point + float(prior.quantile(0.10)), 0))
            upper.append(max(point + float(prior.quantile(0.90)), 0))
        if not actual:
            raise RuntimeError("Not enough nationwide origins for interval evaluation")
        values.update(
            {
                "coverage80_percent": number(
                    100
                    * np.mean(
                        (np.asarray(actual) >= np.asarray(lower))
                        & (np.asarray(actual) <= np.asarray(upper))
                    )
                ),
                "mean_interval_width": number(
                    (np.asarray(upper) - np.asarray(lower)).mean()
                ),
                "coverage_evaluation_predictions": len(actual),
            }
        )
        return values

    score: dict[str, dict[str, object]] = {}
    for name, column in model_columns.items():
        score[name] = national_score(national_backtest, column)
        score[name]["by_horizon"] = {
            str(horizon): national_score(frame, column)
            for horizon, frame in national_backtest.groupby("horizon_week", sort=True)
        }
        score[name].update(
            {
                "evaluation_origins": int(national_backtest["origin"].nunique()),
                "evaluation_predictions": int(len(national_backtest)),
                "origin_step_weeks": BACKTEST_ORIGIN_STEP,
                "max_horizon_weeks": BACKTEST_HORIZON_WEEKS,
                "coverage_calibration_origins": int(calibration_origin_count),
                "coverage_evaluation_origins": int(len(evaluation_origins)),
                "note": (
                    "Point metrics pool all rolling-origin horizons. Coverage is "
                    "prequential: every interval uses only national residuals "
                    "whose target week precedes that prediction's origin."
                ),
            }
        )
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
        **recent_change_metrics(rows),
    }
    cutoffs = [payload["training"]["cutoff"] for payload in state_payloads.values()]
    starts = [payload["training"]["start"] for payload in state_payloads.values()]
    return {
        "schema_version": SCHEMA_VERSION,
        "uf": "BR",
        "name": "Brasil",
        "ibge_code": "BR",
        "population": CENSUS_2022_TOTAL,
        "training": {
            "start": min(starts),
            "cutoff": min(cutoffs),
            "weeks": TRAIN_WEEKS,
            "terms": TERMS,
            "note": (
                "The Brazil point estimate is the sum of the state nowcasts; "
                "its interval is calibrated from summed independent rolling-origin "
                "residuals."
            ),
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
        "population": payload["population"],
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
        if not isinstance(payload.get("population"), int) or payload["population"] <= 0:
            raise RuntimeError(f"Invalid population in {path}")
        for model_name, score in payload["backtest"].items():
            if "coverage80_percent" not in score or "mean_interval_width" not in score:
                raise RuntimeError(f"Missing interval metrics for {uf}/{model_name}")
            coverage80 = score["coverage80_percent"]
            interval_width = score["mean_interval_width"]
            if coverage80 is not None and not 0 <= coverage80 <= 100:
                raise RuntimeError(f"Invalid interval coverage for {uf}/{model_name}")
            if interval_width is not None and interval_width < 0:
                raise RuntimeError(f"Invalid interval width for {uf}/{model_name}")
            by_horizon = score.get("by_horizon")
            if score.get("n") is not None:
                expected_horizons = {
                    str(horizon) for horizon in range(1, BACKTEST_HORIZON_WEEKS + 1)
                }
                if not isinstance(by_horizon, dict) or set(by_horizon) != expected_horizons:
                    raise RuntimeError(f"Invalid horizons for {uf}/{model_name}")
                for horizon, horizon_score in by_horizon.items():
                    horizon_coverage = horizon_score.get("coverage80_percent")
                    horizon_width = horizon_score.get("mean_interval_width")
                    if not isinstance(horizon_score.get("n"), int) or horizon_score["n"] < 1:
                        raise RuntimeError(
                            f"Empty horizon {horizon} for {uf}/{model_name}"
                        )
                    if horizon_coverage is not None and not 0 <= horizon_coverage <= 100:
                        raise RuntimeError(
                            f"Invalid horizon coverage for {uf}/{model_name}/{horizon}"
                        )
                    if horizon_width is not None and horizon_width < 0:
                        raise RuntimeError(
                            f"Invalid horizon width for {uf}/{model_name}/{horizon}"
                        )
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
        if "infogripe" in summary.get("sources", {}):
            combined = latest.get("combined")
            combined_lower = latest.get("combined_lower80")
            combined_upper = latest.get("combined_upper80")
            envelope_lower = latest.get("combined_envelope_lower")
            envelope_upper = latest.get("combined_envelope_upper")
            if None in (
                combined,
                combined_lower,
                combined_upper,
                envelope_lower,
                envelope_upper,
            ):
                raise RuntimeError(f"Missing latest InfoGripe mixture for {uf}")
            if not (
                0 <= envelope_lower <= combined_lower <= combined <= combined_upper
                <= envelope_upper
            ):
                raise RuntimeError(f"Invalid latest InfoGripe mixture for {uf}")


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
            ufs,
            start,
            end,
            args.cache_dir,
            args.max_retries,
            resources=(
                local_srag_resources(args.cache_dir)
                if args.pin_local_sivep
                else None
            ),
        )

    infogripe = None
    infogripe_meta = None
    if not args.skip_infogripe:
        infogripe, infogripe_meta = load_infogripe(
            args.infogripe_file, args.max_retries
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
    if infogripe is not None:
        for uf in ufs:
            attach_infogripe_mixture(state_payloads[uf], infogripe)
        attach_infogripe_mixture(brazil, infogripe)
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
                "name": "50% LASSO + 50% smoothed annual nowcast",
                "training_weeks": TRAIN_WEEKS,
                "consolidation_lag_days": PROVISIONAL_LAG_DAYS,
                "interval": (
                    "Conformal 80% band: empirical 10th/90th percentile of "
                    "time-series out-of-fold residuals added to the point forecast. "
                    "The Brazil band uses residuals of the summed state nowcasts."
                ),
                "interpretation": (
                    "Same-week nowcast after Google Trends is observed; "
                    "not a forecast of future weeks."
                ),
            },
            "sources": {
                "google_trends": trends_meta,
                "srag": srag_meta,
                **(
                    {"infogripe": infogripe_meta}
                    if infogripe is not None
                    else {}
                ),
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
