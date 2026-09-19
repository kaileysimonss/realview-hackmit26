---
name: realview-browser-testing
description: Run RealView's unpacked Chrome extension against its controlled local mixed-media demo.
---

# Setup
- From the repository root run `python3 -m http.server 8000 --directory demo`.
- In Chrome for Testing, open `chrome://extensions`, enable Developer mode, and
  Load unpacked from the repository's `extension` directory, not its root.
- Open `http://localhost:8000`; HTTP avoids the separate file-URL permission.
- When retesting a revision, click Reload on the extension card, then reload or
  reopen the demo page so its content script also uses the new code.
- No build or package installation is required for this static extension/demo.

# Browser checks
- Use the toolbar popup on the demo tab so per-site settings target localhost.
- Begin with enabled, threshold 60%, text/image blur, video warning.
- Scroll through all fixtures before comparing final counts; scanning is
  viewport-dependent. Expect original synthetic text scores 64/72%, images
  about 87–89%, and generated video about 90%.
- Change thresholds and treatments without reloading. Check both visual media
  dimensions and `.rv-wrap .rv-wrap` counts: settings refresh should not grow
  nested wrappers, and disabling/unflagging should restore original layout.
- Check privacy inputs, badge reveal, and Load more posts with actual UI actions.
- For seek restoration, supplement browser playback with a runtime audit of
  the installed detector against real demo video elements. Test paused and
  playing at a nonzero timestamp, record seek events and three sampled frames.
  Keep detector-level evidence distinct from automatic content-scan evidence.

# Devin Secrets Needed
None. The extension and fixtures operate locally without authentication.

# Cross-origin media
- Serve `demo/assets` on a second port with Python's HTTP server (no CORS
  headers), and use a temporary page on the first origin to reference those
  assets. Include an image, a video with poster, and a video without poster.
  Remove the temporary page and stop the second server after testing.
- Reload the extension before opening its service-worker Inspect view. Keep
  Network capture active while navigating first to same-origin fixtures, then
  cross-origin fixtures. Same-origin canvas reads should not fetch via worker;
  repeated scans/reloads should reuse URL stats while that worker remains alive.
- A low-scoring image can be below the popup's minimum threshold. Use a
  supplemental real-detector audit rather than claiming its badge was inspected.
- External pages exercise host CSS and anchors beyond the demo: compare media
  rectangles before/after treatments, including absolute-positioned images, and
  verify clicking a badge does not follow an enclosing link.
- For floating badges, compare badge/media rectangles before and after scrolling:
  expected offsets are +8 CSS pixels on both axes. Check disable/re-enable removes
  and restores a single badge without wrapping out-of-flow media.
- Include a statically positioned linked image when testing anchor cancellation:
  a body-level floating badge is not inside the anchor and cannot exercise that
  path. Check both summary and Reveal/Hide controls without URL changes.
- Poster-backed video should explain poster-only analysis, while no-poster
  fallback should explain metadata-only analysis; both must retain hedged wording.
- For layout-watcher checks, disable scroll anchoring and hide/restore a heading
  before the media. Count scroll/resize events to prove movement was layout-only.
  Count rAF callbacks in the extension isolated world, not only the page world.
  Forward native rAF unchanged; count DOM mutations separately. After settling,
  sample a foreground idle interval and renderer TaskDuration (threadTicks) CPU.
  Reload afterward to remove temporary instrumentation.
- Browser-console tooling may omit historical host exceptions. Inspect DevTools
  or CDP Runtime events too, distinguishing page-script errors from extension
  contexts rather than claiming the entire external page is error-free.
