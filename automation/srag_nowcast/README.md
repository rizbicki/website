# SRAG nowcast dashboard

This directory contains the production pipeline used by the SRAG dashboard at
`/srag-nowcast/`.

## What it estimates

For each Brazilian state, the model uses the same-week Google Trends values for
`gripe`, `sintomas gripe`, and `tosse`. A LASSO fitted on the latest 104
consolidated weeks is averaged with a seasonal lag-52 estimate. The result is a
same-week **nowcast**, not a forecast for an unobserved future week.

The Brazil estimate is the sum of the 27 state estimates. The 80% bands are
empirical, based on time-series out-of-fold residuals. The nationwide band is
the sum of the state bands and should be treated as approximate.

## Production schedule

The GitHub Actions workflow at
`.github/workflows/update-srag-nowcast.yml` collects Google Trends in small
daily batches from Monday through Saturday. Each state is checkpointed
immediately in the Actions cache. On Saturday, after all 27 checkpoints are
available, the workflow downloads or reuses the SIVEP-Gripe files, rebuilds the
models, validates the complete JSON bundle, and commits it. Netlify then
deploys the new site from the commit.

A failed build never replaces the last validated dashboard data. The workflow
also opens or updates a GitHub issue when an automated run fails.

## Local commands

Install dependencies:

```bash
python -m pip install -r automation/srag_nowcast/requirements.txt
```

Collect selected Trends checkpoints:

```bash
python automation/srag_nowcast/update_dashboard.py \
  --collect-trends-only \
  --ufs SP RJ PE \
  --trends-cache-dir automation/srag_nowcast/.cache/google_trends
```

Build all states from checkpoints:

```bash
python automation/srag_nowcast/update_dashboard.py \
  --from-trends-cache \
  --trends-cache-dir automation/srag_nowcast/.cache/google_trends \
  --cache-dir automation/srag_nowcast/.cache/sivep_gripe \
  --output-dir static/dashboard/srag/data
```

Validate the published bundle:

```bash
python automation/srag_nowcast/update_dashboard.py \
  --validate-output \
  --output-dir static/dashboard/srag/data
```

The Trends values are normalized 0–100 separately for each three-term state
request. They are not search counts and must not be compared directly between
states. Google Trends is sampled, so repeated extractions may differ slightly.
