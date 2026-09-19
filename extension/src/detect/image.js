(() => {
  const { ramp, clamp, combine, verdict, topSignals } = self.RealViewSignals;

  const NAME_HINTS = /(midjourney|dall-?e|stable-?diffusion|sdxl|firefly|generated|ai-?gen|synthid|flux-?pro|imagen|sora)/i;
  const SAMPLE = 96;

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
      return null; // cross-origin pixels are unreadable; fall back to metadata signals
    }

    const luma = new Float32Array(SAMPLE * SAMPLE);
    let saturationSum = 0;
    for (let i = 0; i < SAMPLE * SAMPLE; i += 1) {
      const r = data[i * 4] / 255;
      const g = data[i * 4 + 1] / 255;
      const b = data[i * 4 + 2] / 255;
      luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      saturationSum += max === 0 ? 0 : (max - min) / max;
    }

    // Sensor noise: mean absolute residual against a 3x3 box blur.
    let residualSum = 0;
    let edgeSum = 0;
    let samples = 0;
    for (let y = 1; y < SAMPLE - 1; y += 1) {
      for (let x = 1; x < SAMPLE - 1; x += 1) {
        const idx = y * SAMPLE + x;
        let neighborhood = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            neighborhood += luma[(y + dy) * SAMPLE + (x + dx)];
          }
        }
        residualSum += Math.abs(luma[idx] - neighborhood / 9);
        const gx = luma[idx + 1] - luma[idx - 1];
        const gy = luma[idx + SAMPLE] - luma[idx - SAMPLE];
        edgeSum += Math.hypot(gx, gy);
        samples += 1;
      }
    }

    const histogram = new Array(32).fill(0);
    for (let i = 0; i < luma.length; i += 1) {
      histogram[Math.min(31, Math.floor(luma[i] * 32))] += 1;
    }
    const occupied = histogram.filter((n) => n > luma.length * 0.002).length / 32;

    return {
      noise: residualSum / samples,
      edges: edgeSum / samples,
      saturation: saturationSum / (SAMPLE * SAMPLE),
      tonalSpread: occupied,
      width,
      height
    };
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
    const stats = pixelStats(el, el.naturalWidth, el.naturalHeight);
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
        limited: true
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

  self.RealViewImageDetector = { analyze, pixelStats, scoreStats };
})();
