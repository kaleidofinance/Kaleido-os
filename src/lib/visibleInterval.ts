/**
 * setInterval that only ticks while the tab is visible.
 *
 * Every background tab used to keep polling (orders every 60s, pools every 30s,
 * announcements every 5 min) — a tab left open all day is thousands of requests,
 * and across ~800 daily users that pushed the site to 4× its Vercel CDN request
 * allowance (2026-10-05). Hidden tabs now make no requests; when the tab comes
 * back, `fn` runs at once if a tick was missed, so data is never older than one
 * interval from the user's point of view.
 *
 * Returns a cleanup function. Does not call `fn` on start — callers already do.
 */
export function visibleInterval(fn: () => void, ms: number): () => void {
  if (typeof document === "undefined") return () => {};
  let last = Date.now();
  const tick = () => {
    if (document.visibilityState !== "visible") return;
    last = Date.now();
    fn();
  };
  const id = window.setInterval(tick, ms);
  const onVisible = () => {
    if (document.visibilityState === "visible" && Date.now() - last >= ms) tick();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
