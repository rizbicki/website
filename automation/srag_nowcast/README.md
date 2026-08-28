# SRAG nowcast dashboard

Production wiring for the dashboard at `/srag-nowcast/`. **The model, the data
ingestion and the evaluation are not here** — they live in the private
[`rizbicki/gripe`](https://github.com/rizbicki/gripe) repository, which this
directory installs at a pinned tag and calls.

## Promotion and rollback

`requirements.txt` pins one tag of `gripe`. That pin is the only mechanism by
which a model reaches the site:

1. Develop and evaluate in `gripe`, against its frozen protocol.
2. Tag a release there.
3. Bump the tag in `requirements.txt` here.
4. Rolling back is reverting that one line.

Testing a model never touches this repository, and the dashboard can never be
running something that was not tagged.

## What it estimates

Per state, a nowcast of same-week SRAG notifications from same-week Google
Trends for `gripe`, `sintomas gripe` and `tosse`. The Brazil estimate is the sum
of the 27 state estimates; the nationwide band is the sum of the state bands and
should be treated as approximate. It is a same-week **nowcast**, not a forecast
of an unobserved future week.

## Production schedule

`.github/workflows/update-srag-nowcast.yml` collects Google Trends in small
daily batches Monday through Saturday, checkpointing each state in the Actions
cache. On Saturday it rebuilds the models, validates the complete JSON bundle
and commits it; Netlify deploys from the commit.

A failed build never replaces the last validated dashboard data, and the
workflow opens or updates a GitHub issue when an automated run fails.

### Access to the private package

The build installs `gripe` over SSH using a read-only deploy key. The private
key is the `GRIPE_DEPLOY_KEY` Actions secret in this repository; the matching
public key is registered as a read-only deploy key on `rizbicki/gripe`. Without
that secret the build fails fast rather than publishing stale or partial data.

### Trends vintages

Google Trends is sampled and renormalised per request, so checkpoints cannot be
reproduced by refetching. Every publishing run uploads the checkpoints behind it
as a 90-day artifact, and the `archive-trends` dispatch exports the current
cache on demand. The durable archive lives in `gripe` under
`data/trends_archive/<date>/`.

## Local commands

```bash
python -m pip install -r automation/srag_nowcast/requirements.txt

gripe --collect-trends-only --ufs SP RJ PE \
  --trends-cache-dir automation/srag_nowcast/.cache/google_trends

gripe --from-trends-cache \
  --trends-cache-dir automation/srag_nowcast/.cache/google_trends \
  --cache-dir automation/srag_nowcast/.cache/sivep_gripe \
  --output-dir static/dashboard/srag/data

gripe --validate-output --output-dir static/dashboard/srag/data
```

Trends values are normalized 0–100 separately for each three-term state request.
They are not search counts and must not be compared directly between states.
