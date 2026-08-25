#!/usr/bin/env bash
# Route inventory probe. Nothing is deployed and two migrations are unpushed, so
# the question is not "is the data right" but "does every interface render at
# all" — which of the 22 pages exist, which throw, and which are reachable.
#
# A status code alone cannot answer that. Next's dev server returns 200 for a
# page whose client tree throws, and returns the error overlay in the body. So
# each probe also checks for the `kaleido-v2` wrapper that (app)/layout.tsx
# emits: present means the layout and page tree both rendered server-side.
BASE="${BASE:-http://localhost:3000}"

# 300s, not 120s. A cold route here takes minutes, not seconds: /trade measured
# 282s to serve a *redirect*, because Next compiles the route group before it
# will answer at all. At 120s the probe reported `000` for routes that were
# merely still compiling, which reads as "broken" and is not.
CEILING="${CEILING:-300}"

probe() {
  local path="$1"
  local body status size layout marker t
  body=$(curl -s -m "$CEILING" -w '\n__STATUS__%{http_code}__TIME__%{time_total}' "$BASE$path" 2>/dev/null)
  status=$(printf '%s' "$body" | tail -1 | sed 's/.*__STATUS__//; s/__TIME__.*//')
  t=$(printf '%s' "$body" | tail -1 | sed 's/.*__TIME__//')
  body=$(printf '%s' "$body" | sed '$d')
  size=$(printf '%s' "$body" | wc -c | tr -d ' ')

  layout="-"
  printf '%s' "$body" | grep -q 'kaleido-v2' && layout="layout-ok"

  marker=""
  # Only trust a 404 from the status line. Next's dev bundles inline the
  # not-found component into every page's HTML, so grepping the body for "This
  # page could not be found" matches on pages that rendered perfectly well —
  # it reported a 404 for /trade/swap, which returns 200 with a full layout.
  [ "${status:-000}" = "404" ] && marker="404"
  printf '%s' "$body" | grep -qi 'Unhandled Runtime Error' && marker="RUNTIME-ERROR"
  printf '%s' "$body" | grep -qi 'Error: Cannot find module' && marker="MISSING-MODULE"
  [ "${status:-000}" = "500" ] && marker="500-SERVER-ERROR"
  [ "${status:-000}" = "000" ] && marker="TIMEOUT>${CEILING}s (still compiling?)"
  # A 200 that never emitted the (app) wrapper did not render the page tree.
  [ "${status:-000}" = "200" ] && [ "$layout" = "-" ] && marker="200 BUT NO LAYOUT"

  printf '%-24s %-5s %-9s %-9s %-12s %s\n' "$path" "${status:-ERR}" "$size" "${t%%.*}s" "$layout" "$marker"
}

echo "PATH                     CODE  BYTES     TIME      LAYOUT       NOTE"
echo "--------------------------------------------------------------------------------"
for p in \
  / /explore \
  /trade /trade/swap /trade/limit /trade/buy /trade/sell /trade/agent \
  /pool /pool/new /pool/positions \
  /borrow /lend /loans /mylends /myloans \
  /stable /stable/mint /stable/redeem /stable/earn \
  /stake /leaderboard /portfolio /notifications \
  /definitely-not-a-real-route ; do
  probe "$p"
done
