/* global chrome */
(() => {
  const { ramp, clamp, combine, verdict, topSignals } = self.RealViewSignals;
  const { SAMPLE, statsFromImageData } = self.RealViewPixels;

  const NAME_HINTS =
    /(midjourney|dall-?e|stable-?diffusion|sdxl|firefly|generated|ai-?gen|synthid|flux(-?pro|-?dev|-?schnell)?|imagen|sora|ideogram|leonardo\.?ai|recraft|nova-?canvas|playground-?ai|novelai|craiyon|runway|veo|hailuo|kling|luma-?ai|seedream|qwen-?image|grok-?imagine|nano-?banana)/i;

  // Below this many distinct (quantized) colors in the 96x96 sample, treat it as a flat
  // graphic (logo, icon, illustration) rather than a photo. The noise/edge/saturation/grain
  // signals below are photographic-forensics signals — they assume the input is a photo,
  // real or AI-generated, and produce confidently wrong results on flat color blocks (e.g. a
  // bold-colored logo maxes out "hyper-saturated palette" for reasons that have nothing to do
  // with AI generation). A real photo, even a simple/minimalist one, has JPEG compression
  // artifacts and natural gradients that spread across many more than this after quantization.
  const FLAT_GRAPHIC_COLOR_LIMIT = 24;

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

  // Video reuses this same scoring but with its own (independently tunable) thresholds —
  // sharing image's exact numbers meant any change to satisfy one detector's false-positive/
  // false-negative balance fought the other's, since video's score is mostly (weight 0.6)
  // just the mean of per-frame calls into this function.
  //
  // These bounds (and the DIRECTION of noise/edges/tonalSpread below) come from actually
  // measuring 79 real photos vs real AI-generated images (Picsum stock photography vs
  // Wikimedia Commons' "AI-generated photographs"/"AI-generated portraits" categories, split
  // 60/40 train/test) rather than assumed "diffusion output is clean and smooth" priors from
  // 2022-2023-era models. On that data, noise/edges/tonalSpread were the OPPOSITE of the old
  // assumption — this test set's AI images (modern, often deliberately gritty/stylized) had
  // higher noise, more edge detail, and wider tonal range than the real stock photography, not
  // lower. noiseUniformity remained the strongest, correctly-directioned signal by a wide
  // margin (Cohen's d -1.58 vs -1.22..+0.37 for the others). Held-out test AUC after this
  // change: 0.741, vs 0.588 for the old assumed-direction thresholds — see git history.
  //
  // KNOWN LIMITATION, confirmed empirically rather than assumed: these signals do NOT
  // reliably separate real photos of PEOPLE from AI-generated ones. Tested against 20 real
  // portrait photos (Wikimedia Commons "Portrait photographs"): 7/8 held-out portraits still
  // scored above the Balanced threshold even after reweighting and pushing the decision
  // boundary up to 1.25 standard deviations past the real-photo mean — a margin that, applied
  // globally, simultaneously wrecked general-photo precision (6/17 -> 14/17 false positives)
  // and AI recall (15/15 -> 9/15). That's not a threshold-tuning gap, it's a sign these four
  // pixel signals genuinely overlap for this content category: modern phones apply heavy
  // computational smoothing/sharpening specifically to faces, and several of the AI-image
  // training examples were themselves stylized AI portraits, so "real, processed portrait"
  // and "AI portrait" land in similar territory on noise/edge/grain-uniformity. Fixing this
  // properly would need an actual face/portrait detector to special-case the content type,
  // which this heuristic system doesn't have. Decision (see conversation/commit history):
  // document and accept, rather than chase a global threshold change that can't fix a
  // category-specific problem without breaking the other two categories.
  const DEFAULT_THRESHOLDS = {
    noise: [0.0181, 0.029],
    edges: [0.0785, 0.122],
    saturation: [0.267, 0.356],
    tonalSpread: [0.811, 0.854],
    noiseUniformity: [0.377, 0.787]
  };

  function scoreStats(stats, extraSignals = [], thresholds = DEFAULT_THRESHOLDS) {
    const signalSet = [
      { key: 'Elevated grain/noise', weight: 0.19, value: ramp(stats.noise, ...thresholds.noise) },
      { key: 'Dense fine-detail texture', weight: 0.22, value: ramp(stats.edges, ...thresholds.edges) },
      { key: 'Hyper-saturated palette', weight: 0.11, value: ramp(stats.saturation, ...thresholds.saturation) },
      // Weakest of the five (small effect size on validation data) — kept at low weight
      // rather than dropped, since it was still net-positive on held-out data.
      { key: 'Wide tonal range', weight: 0.07, value: ramp(stats.tonalSpread, ...thresholds.tonalSpread) },
      // Real sensor/film grain varies by region (shadows, texture, ISO); a lot of synthetic
      // or re-added grain lands close to uniform across the whole frame. Survives
      // re-compression better than the raw noise level does, since it's a relative measure.
      // By far the strongest signal on validation data (Cohen's d -1.58) — kept the highest
      // weight of the five.
      {
        key: 'Uniform grain across the frame',
        weight: 0.28,
        value:
          stats.noiseUniformity == null
            ? undefined
            : 1 - ramp(stats.noiseUniformity, ...thresholds.noiseUniformity)
      },
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

    if (stats.colorCount < FLAT_GRAPHIC_COLOR_LIMIT) {
      // Metadata (filename/alt naming a generator) still counts — an AI-generated logo/icon
      // with a revealing filename should still flag — but the photographic-forensics signals
      // (heuristic AND model) are skipped entirely rather than scored and discounted, since
      // the model is trained on photographs and has nothing reliable to say about a flat
      // graphic either way.
      const { score, signals } = combine(meta);
      return {
        kind: 'image',
        score: clamp(score),
        verdict: verdict(score),
        signals: topSignals(signals).map((s) => s.key),
        limited: 'flat-graphic'
      };
    }

    // Local Swin classifier (SMOGY, run in the offscreen document — see local-image.js) added
    // as ONE more signal alongside the pixel heuristics, not a replacement for them: a bare
    // model score has no explainable "why", so folding it into the same combine() call keeps
    // every flag traceable to named, weighted signals instead of trusting an opaque number.
    // Weighted above any single heuristic (0.5 vs. the heaviest heuristic's 0.28) since it's a
    // trained classifier rather than a hand-picked pixel statistic, but well under a majority
    // share so the heuristics still meaningfully move the score when the model is unsure or
    // unavailable (cross-origin image, offscreen/message failure — see local-image.js).
    const modelScore = await self.RealViewLocalImageModel.classify(el);
    const extraSignals =
      modelScore == null
        ? meta
        : [...meta, { key: 'Local AI-image-detection model (Swin/SMOGY)', weight: 0.5, value: modelScore }];

    const { score, signals } = scoreStats(stats, extraSignals);
    return {
      kind: 'image',
      score,
      verdict: verdict(score),
      signals: topSignals(signals).map((s) => s.key)
    };
  }

  self.RealViewImageDetector = { analyze, pixelStats, remotePixelStats, scoreStats, DEFAULT_THRESHOLDS };
})();
