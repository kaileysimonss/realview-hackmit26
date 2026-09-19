/* global chrome */
// Content-side half of model detection: it turns an element into a payload the
// service worker can send to the provider, and shapes the reply like a local
// detector result. Returning null means "fall back to the heuristics".
(() => {
  const { clamp, verdict } = self.RealViewSignals;
  const Video = self.RealViewVideoDetector;

  const MAX_EDGE = 512;
  const VIDEO_FRAMES = 2;

  function rasterize(source, width, height) {
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    try {
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch (err) {
      return null; // cross-origin taint; the worker refetches the bytes instead
    }
  }

  async function imageSources(el) {
    const local = rasterize(el, el.naturalWidth, el.naturalHeight);
    if (local) return { sources: [local] };
    const url = el.currentSrc || el.src;
    return url && !url.startsWith('blob:') ? { sources: [url] } : { sources: [] };
  }

  async function videoSources(el) {
    if (!el.videoWidth) {
      return el.poster ? { sources: [el.poster], limited: 'poster' } : { sources: [] };
    }
    const wasPaused = el.paused;
    const originalTime = el.currentTime;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    el.pause();

    const sources = [];
    for (let i = 0; i < VIDEO_FRAMES; i += 1) {
      if (duration) await Video.seek(el, ((i + 1) / (VIDEO_FRAMES + 1)) * duration);
      const frame = rasterize(el, el.videoWidth, el.videoHeight);
      if (frame) sources.push(frame);
      if (!duration) break;
    }

    if (duration) await Video.seek(el, originalTime);
    if (!wasPaused) el.play().catch(() => {});

    if (sources.length) return { sources };
    // Cross-origin frames taint the canvas and the worker cannot decode a video
    // stream, so the poster is the only image the model can be shown.
    return el.poster ? { sources: [el.poster], limited: 'poster' } : { sources: [] };
  }

  async function payload(el, kind) {
    if (kind === 'text') {
      const text = el.innerText.replace(/\s+/g, ' ').trim();
      return text.length > 120 ? { text } : null;
    }
    const built = kind === 'video' ? await videoSources(el) : await imageSources(el);
    return built.sources.length ? built : null;
  }

  async function analyze(el, kind) {
    const built = await payload(el, kind);
    if (!built) return null;

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'realview:llm',
        request: { kind, text: built.text, sources: built.sources }
      });
    } catch (err) {
      return null;
    }
    if (!response || !response.verdict) return null;

    const score = clamp(response.verdict.score);
    return {
      kind,
      score,
      verdict: verdict(score),
      signals: response.verdict.reason ? [response.verdict.reason] : [],
      limited: built.limited,
      source: 'llm',
      model: response.model
    };
  }

  self.RealViewModelDetector = { analyze };
})();
