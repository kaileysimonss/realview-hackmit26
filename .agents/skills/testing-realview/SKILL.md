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
