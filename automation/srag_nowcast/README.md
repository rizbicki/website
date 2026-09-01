# SRAG nowcast dashboard

This directory contains the production pipeline used by the SRAG dashboard at
`/srag-nowcast/`.

## What it estimates

For each Brazilian state, the model uses the same-week Google Trends values for
`gripe`, `sintomas gripe`, and `tosse`. A LASSO fitted on the latest 104
consolidated weeks is averaged with the mean observed at lag 52 +/- 2 weeks.
The result is a same-week **nowcast**, not a forecast for an unobserved future
week. Its response is the weekly number of SIVEP-Gripe records satisfying the
InfoGripe-compatible filter: cough or sore throat; dyspnea, oxygen saturation
below 95%, or respiratory distress; and hospitalization or death. The total
unfiltered count is retained in the JSON as `observed_total` for auditing, but
is not the model target.

The Brazil estimate is the sum of the 27 state estimates. Published state bands
use residuals wholly preceding the current target. Historical metrics use
independent outer rolling origins: tuning and calibration see only preceding
weeks. National coverage is prequential, using only summed residuals from
earlier origins.

The dashboard also displays the reporting-delay nowcasts and 80% credible
intervals published by **InfoGripe — MAVE (PROCC/Fiocruz and EMap/FGV) and
GT-Influenza/Ministry of Health**. These values are imported from the official
public repository; the InfoGripe Brazil estimate is not a sum made by this site.

The local model and InfoGripe therefore share the same filtered SRAG target; no
total-to-filtered scaling is applied. The experimental combined mode forms a
50/50 linear predictive pool on the `log1p` scale. The orange band is the
official InfoGripe 80% interval, the purple band is the pool's central 80%
interval, and the gray band is the conservative envelope of both component
intervals.
The weight and combined coverage remain unscored until enough immutable weekly
vintages have accumulated in `rizbicki/gripe`.

Each component is displayed through its own latest available week. A state can
therefore show a newer Trends nowcast while InfoGripe remains on an earlier
week, or vice versa. The combined model stops at the latest week where both
components are available; one source never truncates the other.

The nowcast map displays incidence per 100,000 residents, using resident
population from the 2022 IBGE Census. All other count displays remain absolute;
the recent-change map remains a percentage. The historical performance section reports rolling-origin WAPE, mean bias,
empirical 80% interval coverage, and the number of evaluated predictions for
the selected model and locality. Metrics can be viewed separately for H+1
through H+7 after each refit or pooled across all seven horizons. Every refit
retains the preceding 104-week training window.

## Production schedule

The GitHub Actions workflow at
`.github/workflows/update-srag-nowcast.yml` collects Google Trends in small
daily batches from Monday through Saturday. Each state is checkpointed
immediately in the Actions cache. On Saturday, after all 27 checkpoints are
available, the workflow downloads or reuses the SIVEP-Gripe files, fetches the
current official InfoGripe CSV, rebuilds the local models, validates the complete
JSON bundle, and commits it. The build requires BR plus all 27 UFs, a complete
80% interval on the latest InfoGripe week, and a source no more than 21 days old.
Each weekly data commit therefore preserves the InfoGripe values displayed that
week. Netlify then deploys the new site from the commit.

A failed build never replaces the last validated dashboard data. The workflow
also opens or updates a GitHub issue when an automated run fails.

## Publishing runbook

The source of truth for ingestion, modeling, evaluation, payload generation,
and validation is the versioned `rizbicki/gripe` package. This repository pins
one immutable package tag in `requirements.txt`; the workflow invokes its
`gripe` CLI directly.

### Manual hotfix

1. Start from `origin/main` in a clean worktree. The regular website checkout
   often contains untracked generated images; do not stage, delete, or overwrite
   them.

   ```bash
   git -C ../website fetch origin
   deploy_dir="$(mktemp -d /tmp/website-deploy.XXXXXX)"
   git -C ../website worktree add -b deploy-srag-<slug> "$deploy_dir" origin/main
   ```

2. Implement and test the change in `rizbicki/gripe`, publish a tagged release,
   then update only the pinned tag here. Update this README when the published
   interpretation changes.
3. Generate the bundle from a complete set of all 27 Trends checkpoints and the
   intended SIVEP cache, then validate it before copying anything into
   `static/`.

   ```bash
   gripe --from-trends-cache --trends-cache-dir "$TRENDS_CACHE" --cache-dir "$SIVEP_CACHE" --output-dir /tmp/srag-bundle
   gripe --validate-output --output-dir /tmp/srag-bundle
   ```

4. Audit the JSON semantically. In particular, reject local `file://` source
   URLs, confirm that state point forecasts did not change unless intended, and
   copy only the files that materially changed. Run `git diff --check` and
   validate the final in-repository bundle once more.
5. Commit only the pipeline, documentation, and validated data files in scope,
   then push the clean worktree to `main`.

   ```bash
   git push origin HEAD:main
   ```

6. Verify the deployed payload, not just the Git commit. Use a cache-busting
   query and check the values and explanatory note.

   ```bash
   curl -fsSL "https://rafaelizbicki.com/dashboard/srag/data/states/BR.json?deploy=<commit>"
   ```

Netlify deploys commits from `main`. For rollback, use `git revert <commit>`
and push the revert; do not rewrite shared history.

### Tag-based promotion

1. test and merge `gripe`;
2. bump its package version, create and push an annotated `vX.Y.Z` tag;
3. bump the single pinned dependency line in `requirements.txt`;
4. run the website workflow with `batch=build`, watch it to completion, and
   verify the public JSON as above.

That workflow requires an Actions secret named `GRIPE_DEPLOY_KEY` whose public
half is a read-only deploy key on `rizbicki/gripe`. Document only the secret
name and setup requirement: never commit the private key, its local path, or its
value.

## Local commands

Install dependencies:

```bash
python -m pip install -r automation/srag_nowcast/requirements.txt
```

Collect selected Trends checkpoints:

```bash
gripe \
  --collect-trends-only \
  --ufs SP RJ PE \
  --trends-cache-dir automation/srag_nowcast/.cache/google_trends
```

Build all states from checkpoints:

```bash
gripe \
  --from-trends-cache \
  --trends-cache-dir automation/srag_nowcast/.cache/google_trends \
  --cache-dir automation/srag_nowcast/.cache/sivep_gripe \
  --output-dir static/dashboard/srag/data
```

Validate the published bundle:

```bash
gripe \
  --validate-output \
  --output-dir static/dashboard/srag/data
```

The Trends values are normalized 0–100 separately for each three-term state
request. They are not search counts and must not be compared directly between
states. Google Trends is sampled, so repeated extractions may differ slightly.
