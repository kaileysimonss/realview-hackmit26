# RealView — AI Media Detector (HackMIT 2026)

An accessibility layer for the AI-generated internet: a browser extension that detects likely
AI-generated **text, images, and video** on the page you are reading, then lets you decide how
synthetic content appears. Ad blocker, but for synthetic content.

RealView reports **signals and likelihood, never proof**. Every treatment is reversible with a
per-item reveal control.

## What is here

```
extension/          Manifest V3 extension
  src/content.js      page observer + media router (MutationObserver for infinite scroll)
  src/detect/         text, image, and video-frame detectors (all local)
  src/presentation.js treatments, confidence badge, reveal control, scanning indicator
  popup/              settings: threshold, treatment per media type, per-site toggle
demo/               controlled mixed-media feed for the live demo
```

## Run it

```bash
python3 -m http.server 8000 --directory demo   # serve the demo feed
```

1. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, select
   `extension/`.
2. Open <http://localhost:8000>.
3. Click the RealView toolbar icon to adjust the threshold and treatments.

Regenerate demo media with `python3 demo/generate_assets.py` (requires Pillow, numpy, ffmpeg).

## Detection

Two detectors, selected in the popup. The local heuristics run on-device and are the
default; model analysis sends content to an LLM provider and takes over when it is switched
on with a key.

### Local heuristics (default)

| Media | Signals |
| --- | --- |
| Text | sentence-length burstiness, lexical variety, model-typical phrasing, contraction rate, personal voice, templated structure |
| Images | sensor-noise residual, local edge energy, saturation, tonal spread, generator names in filename/alt |
| Video | the image signals over sampled frames, plus frame-to-frame consistency |

Media served from another domain taints the page canvas, so the service worker refetches
those bytes (credentials omitted) and measures them off-screen; results are cached per URL.
Cross-origin video frames still cannot be decoded there, so such videos fall back to their
poster image, then to metadata, and the badge says *Limited analysis*.

Scores map to *High likelihood of AI generation* (≥0.8), *Likely AI-generated* (≥0.6),
*Possible synthetic content* (≥0.4). Anything below the user's threshold is left alone.

These are heuristics chosen for an honest, offline, real-time demo; they are not a truth
machine, and polished human writing or compressed media can trip them. The UI is built around
that fact: confidence is always shown, the driving signals are listed, and the user sets the
threshold.

### Model analysis (opt-in)

Turn on *AI model analysis* in the popup, pick OpenAI or Anthropic, and paste your own API
key. Each visible passage, image, and pair of video frames is then judged by the model,
which returns a 0–100 likelihood and a one-line reason that becomes the badge's explanation.

- The key is kept in `chrome.storage.local` on that machine (never `sync`, never the page)
  and the request is issued from the service worker, so the page can neither read the key
  nor see the response.
- Frames are downscaled to 512px JPEG and passages truncated at 4000 characters; calls are
  capped at 3 concurrent and `llmMaxItems` (40) per page, and cached per content hash.
- The heuristics still run first and remain the result whenever the model call fails, the
  key is missing, or the budget is spent — so the extension never goes silent.

## Treatments

- **Text** — blur, strikethrough, recolor, dim, label only
- **Images** — blur, hide, warning overlay, label only
- **Video** — blur, pause playback, warning overlay, label only

## Privacy

- Only visible page content is analyzed. With model analysis off (the default), everything
  stays on-device and the one network request is the extension refetching a cross-origin
  image from the host that already served it to the page, without credentials.
- With model analysis on, the passages and downscaled frames being scored are sent to the
  provider you chose, under your own key. Nothing goes to a RealView service — there isn't
  one. The scanning indicator says so while it is active, and the badge repeats it.
- Inputs, textareas, selects, forms, and contenteditable regions are never read, and any
  element (or ancestor) marked `data-realview-exclude` is skipped.
- A scanning indicator shows when RealView is active; scanning can be disabled per site.
- Nothing is stored beyond the current page view; settings sync only user preferences.

## Demo sequence

Unfiltered mixed-media feed → enable the extension → cross-media filtering → lower the
threshold for aggressive filtering → reveal one item to show its confidence and signals →
scroll to show newly loaded posts being filtered live.
