#!/usr/bin/env bash
# Deploy the newest image built by .github/workflows/image.yml to the VPS.
# Usage: scripts/deploy-vps.sh [run-id]   (default: latest successful run on main)
set -euo pipefail
REPO=openpromoter/openpromoter
HOST=${VPS_HOST:-root@145.79.2.22}

RUN=${1:-$(gh run list --repo "$REPO" --workflow image.yml --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId')}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "downloading image from run $RUN"
gh run download "$RUN" --repo "$REPO" --name image --dir "$TMP"

echo "loading on $HOST"
TAG=$(gunzip -c "$TMP/image.tar.gz" | ssh "$HOST" 'docker load' | sed -n 's/^Loaded image: //p' | tail -1)
ssh "$HOST" "docker tag $TAG openpromoter:current && cd /opt/openpromoter && docker compose up -d && docker image prune -f >/dev/null"

echo "waiting for health"
for _ in $(seq 30); do
  ssh "$HOST" 'curl -fsS http://127.0.0.1:3100/api/health' && { echo; echo "deployed $TAG"; exit 0; }
  sleep 4
done
echo "app did not become healthy; see: ssh $HOST 'cd /opt/openpromoter && docker compose logs --tail 100 app'" >&2
exit 1
