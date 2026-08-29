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
calibrated from residuals of the summed state nowcasts.

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

## Publishing runbook

The production source of truth is currently this repository: the workflow runs
`automation/srag_nowcast/update_dashboard.py`. A change committed only to
`rizbicki/gripe` does **not** reach the live dashboard. Until the package
migration described below is enabled, any production pipeline fix must also be
ported to this script.

### Manual hotfix

1. Start from `origin/main` in a clean worktree. The regular website checkout
   often contains untracked generated images; do not stage, delete, or overwrite
   them.

   ```bash
   git -C ../website fetch origin
   deploy_dir="$(mktemp -d /tmp/website-deploy.XXXXXX)"
   git -C ../website worktree add -b deploy-srag-<slug> "$deploy_dir" origin/main
   ```

2. Make the smallest corresponding change in
   `automation/srag_nowcast/update_dashboard.py` and update this README when
   the published interpretation changes.
3. Generate the bundle from a complete set of all 27 Trends checkpoints and the
   intended SIVEP cache, then validate it before copying anything into
   `static/`.

   ```bash
   python automation/srag_nowcast/update_dashboard.py --from-trends-cache --trends-cache-dir "$TRENDS_CACHE" --cache-dir "$SIVEP_CACHE" --output-dir /tmp/srag-bundle
   python automation/srag_nowcast/update_dashboard.py --validate-output --output-dir /tmp/srag-bundle
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

### Planned tag-based promotion

The branch `flip-to-gripe-package` replaces the duplicated script with a
pinned `gripe` release. Once that migration is merged, promotion becomes:

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
