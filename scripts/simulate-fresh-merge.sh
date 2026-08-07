#!/usr/bin/env bash
# Simulate a fresh merge with the latest PR base branch before checks run.
# Adapted from link-foundation CI/CD templates.
set -euo pipefail

if [[ -z "${BASE_REF:-}" ]]; then
  echo "::error::BASE_REF is required"
  exit 2
fi

git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"
git fetch --no-tags origin "$BASE_REF"

BEHIND_COUNT=$(git rev-list --count "HEAD..origin/$BASE_REF")
if [[ "$BEHIND_COUNT" -eq 0 ]]; then
  echo "Fresh-merge check: current checkout already contains latest $BASE_REF"
  exit 0
fi

echo "Fresh-merge check: base has $BEHIND_COUNT newer commit(s); merging origin/$BASE_REF"
if ! git merge "origin/$BASE_REF" --no-edit; then
  echo "::error::Fresh merge with $BASE_REF failed. Update/rebase the pull request."
  exit 1
fi

echo "Fresh-merge simulation succeeded"
