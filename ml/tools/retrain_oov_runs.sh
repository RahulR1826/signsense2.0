#!/usr/bin/env bash
# Milestone 1 retrain: published-model settings, now with all 931 OOV training clips (and a variant without
# "gift", which the published model reads as "baby"). Seeds 0-2 on the official split, seed 0 on the session split.
# Run from ml/. Each run prints "run dir: ..." and writes report.json there.
set -u
PY=.venv/Scripts/python
export MLFLOW_DISABLE_AGENT_HINT=1
for variant in all nogift; do
  extra=""
  [ "$variant" = nogift ] && extra="--exclude-oov oov-hom-gift"
  for seed in 0 1 2; do
    echo "=== $variant official seed $seed"
    $PY -m signsense_ml.train --model cnn --protocol official --seed $seed --tag "oov931-$variant-s$seed" $extra 2>&1 | grep -E "run dir|test|unknown|Error|error" | tail -6
  done
  echo "=== $variant session seed 0"
  $PY -m signsense_ml.train --model cnn --protocol session --seed 0 --tag "oov931-$variant-session-s0" $extra 2>&1 | grep -E "run dir|test|unknown|Error|error" | tail -6
done
echo "=== ALL DONE"
