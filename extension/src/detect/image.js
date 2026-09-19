/* global chrome */
(() => {
  const { ramp, clamp, combine, verdict, topSignals } = self.RealViewSignals;
  const { SAMPLE, statsFromImageData } = self.RealViewPixels;

  const NAME_HINTS = /(midjourney|dall-?e|stable-?diffusion|sdxl|firefly|generated|ai-?gen|synthid|flux-?pro|imagen|sora)/i;

  function makeCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    return canvas;
  }

  function pixelStats(source, width, height) {
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, SAMPLE, SAMPLE);
    let data;
    try {
      data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
    } catch (err) {
      return null; // canvas is tainted; the service worker refetches the bytes instead
    }
    return statsFromImageData(data, width, height);
  }

  // Cross-origin media taints the page canvas, so the service worker (which has
  // host permissions and its own origin) refetches the bytes and measures them.
  async function remotePixelStats(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'realview:pixelStats', url });
      return response && response.stats ? response.stats : null;
    } catch (err) {
      return null;
    }
  }

  function scoreStats(stats, extraSignals = []) {
    const signalSet = [
      // Diffusion output is unusually clean at the pixel level.
      { key: 'Low sensor noise', weight: 0.3, value: 1 - ramp(stats.noise, 0.004, 0.02) },
      { key: 'Over-smooth local detail', weight: 0.16, value: 1 - ramp(stats.edges, 0.03, 0.12) },
      { key: 'Hyper-saturated palette', weight: 0.16, value: ramp(stats.saturation, 0.3, 0.62) },
      { key: 'Compressed tonal range', weight: 0.1, value: 1 - ramp(stats.tonalSpread, 0.45, 0.95) },
      ...extraSignals
    ];
    return combine(signalSet);
  }

  function metadataSignals(el) {
    const haystack = `${el.currentSrc || el.src || ''} ${el.alt || ''} ${el.dataset.source || ''}`;
    return [
      { key: 'Filename or alt text names a generator', weight: 0.28, value: NAME_HINTS.test(haystack) ? 1 : 0 }
    ];
  }

  async function ready(el) {
    if (el.complete && el.naturalWidth > 0) return true;
    return new Promise((resolve) => {
      const done = (ok) => resolve(ok);
      el.addEventListener('load', () => done(true), { once: true });
      el.addEventListener('error', () => done(false), { once: true });
      setTimeout(() => done(el.naturalWidth > 0), 3000);
    });
  }

  async function analyze(el) {
    if (!(await ready(el))) return null;
    if (el.naturalWidth < 80 || el.naturalHeight < 80) return null;

    const meta = metadataSignals(el);
    const local = pixelStats(el, el.naturalWidth, el.naturalHeight);
    const stats = local || (await remotePixelStats(el.currentSrc || el.src));
    if (!stats) {
      const { score, signals } = combine([
        ...meta,
        { key: 'Pixels unreadable (cross-origin)', weight: 0.05, value: 0.2 }
      ]);
      return {
        kind: 'image',
        score: clamp(score),
        verdict: verdict(score),
        signals: topSignals(signals).map((s) => s.key),
        limited: 'metadata'
      };
    }

    const { score, signals } = scoreStats(stats, meta);
    return {
      kind: 'image',
      score,
      verdict: verdict(score),
      signals: topSignals(signals).map((s) => s.key)
    };
  }

  self.RealViewImageDetector = { analyze, pixelStats, remotePixelStats, scoreStats };
})();
