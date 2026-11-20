#!/usr/bin/env bash
# Decrypts the per-file encrypted receipt mirror (private-enc/) back into a media/private tree.
# Run where the owner's key is (docs/run-guide.md, "Disaster recovery").
#   restore-private.sh --identity KEYFILE SRC_DIR DEST_DIR
set -euo pipefail
identity='' args=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --identity) identity=${2:?--identity needs a file}; shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
[[ -r $identity && ${#args[@]} == 2 ]] || { echo 'usage: restore-private.sh --identity KEYFILE SRC_DIR DEST_DIR' >&2; exit 2; }
src=${args[0]} dest=${args[1]}
count=0
while IFS= read -r -d '' enc; do
  rel=${enc#"$src/"}
  out="${dest:?}/${rel%.age}"
  install -d -m 700 "$(dirname "$out")"
  age -d -i "$identity" -o "$out" "$enc"
  touch -r "$enc" "$out"
  count=$((count + 1))
done < <(find "$src" -type f -name '*.age' -print0)
echo "restored $count receipt file(s) into $dest"
