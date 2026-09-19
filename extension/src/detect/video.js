(() => {
  const { clamp, ramp, combine, verdict, topSignals } = self.RealViewSignals;
  const { pixelStats, remotePixelStats, scoreStats } = self.RealViewImageDetector;

  const NAME_HINTS =
    /(sora|runway|pika|veo|synthetic|deepfake|ai-?gen|generated|kling|hailuo|luma-?ai|seedance|wan2|grok-?imagine|midjourney)/i;
  // More samples steady out the per-frame average and the temporal-uniformity signal below;
  // 3 was thin enough that a single unusual frame could swing both.
  const FRAMES = 5;
  // Matches image.js's FLAT_GRAPHIC_COLOR_LIMIT — see there for why.
  const FLAT_GRAPHIC_COLOR_LIMIT = 24;

  // Same corrected direction as image.js's DEFAULT_THRESHOLDS (see that file for the real-data
  // validation behind it — real photos vs real AI-generated images, not assumed priors), with
  // the interval pulled ~15% toward the midpoint so video is modestly more sensitive than
  // image's own thresholds. That specific 15% pull is NOT independently validated against real
  // video (no labeled real-vs-AI video dataset was available), only reasoned from the same
  // physical signals — treat it as a starting point more than a measured value.
  const VIDEO_THRESHOLDS = {
    noise: [0.0189, 0.0281],
    edges: [0.0818, 0.1188],
    saturation: [0.274, 0.349],
    tonalSpread: [0.814, 0.851],
    noiseUniformity: [0.408, 0.756]
  };

  function metadataValue(el) {
    const haystack = `${el.currentSrc || el.src || ''} ${el.getAttribute('poster') || ''} ${el.dataset.source || ''}`;
    return NAME_HINTS.test(haystack) ? 1 : 0;
  }

  function seek(el, time) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      el.addEventListener('seeked', finish, { once: true });
      try {
        el.currentTime = time;
      } catch (err) {
        finish();
      }
      setTimeout(finish, 1200);
    });
  }

  async function metadataReady(el) {
    if (el.readyState >= 2) return true;
    return new Promise((resolve) => {
      el.addEventListener('loadeddata', () => resolve(true), { once: true });
      setTimeout(() => resolve(el.readyState >= 2), 3000);
    });
  }

  async function analyze(el) {
    const meta = [{ key: 'Source names a video generator', weight: 0.28, value: metadataValue(el) }];
    if (!(await metadataReady(el)) || !el.videoWidth) {
      const { score, signals } = combine([...meta, { key: 'Frames unavailable', weight: 0.05, value: 0.2 }]);
      return {
        kind: 'video',
        score,
        verdict: verdict(score),
        signals: topSignals(signals).map((s) => s.key),
        limited: 'metadata'
      };
    }

    const wasPaused = el.paused;
    const originalTime = el.currentTime;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    el.pause();

    const frames = [];
    for (let i = 0; i < FRAMES; i += 1) {
      if (duration) {
        await seek(el, ((i + 1) / (FRAMES + 1)) * duration);
      }
      const stats = pixelStats(el, el.videoWidth, el.videoHeight);
      if (stats) frames.push(stats);
      if (!duration) break;
    }

    if (duration) await seek(el, originalTime);
    if (!wasPaused) el.play().catch(() => {});

    if (!frames.length) {
      // Cross-origin frames taint the canvas and a video stream cannot be decoded
      // in the worker, so the poster image is the only pixel evidence available.
      const poster = await remotePixelStats(el.poster);
      if (poster) {
        // Same double-damping fix as the main path below — this value is already a
        // combine() output, about to go through combine() again.
        const posterScore = clamp(scoreStats(poster, [], VIDEO_THRESHOLDS).score ** 0.7);
        const { score, signals } = combine([
          { key: 'Poster-frame synthetic signals', weight: 0.6, value: posterScore },
          ...meta
        ]);
        return {
          kind: 'video',
          score: clamp(score),
          verdict: verdict(score),
          signals: topSignals(signals).map((s) => s.key),
          limited: 'poster'
        };
      }
      const { score, signals } = combine([...meta, { key: 'Frames unreadable (cross-origin)', weight: 0.05, value: 0.2 }]);
      return {
        kind: 'video',
        score,
        verdict: verdict(score),
        signals: topSignals(signals).map((s) => s.key),
        limited: 'metadata'
      };
    }

    // Same flat-graphic gate as image.js (see there for why) — a screen recording of a slide
    // deck or an animated logo would otherwise max out the saturation/grain signals for
    // reasons that have nothing to do with AI generation. Frames that are flat graphics are
    // excluded from scoring entirely rather than scored and discounted.
    const photographicFrames = frames.filter((stats) => stats.colorCount >= FLAT_GRAPHIC_COLOR_LIMIT);
    if (!photographicFrames.length) {
      const { score, signals } = combine(meta);
      return {
        kind: 'video',
        score: clamp(score),
        verdict: verdict(score),
        signals: topSignals(signals).map((s) => s.key),
        limited: 'flat-graphic'
      };
    }

    const frameScores = photographicFrames.map((stats) => scoreStats(stats, [], VIDEO_THRESHOLDS).score);
    const mean = frameScores.reduce((a, b) => a + b, 0) / frameScores.length;

    // Generated clips tend to look uniformly "clean" frame to frame.
    const spread = Math.max(...frameScores) - Math.min(...frameScores);
    const temporalUniformity = 1 - ramp(spread, 0.02, 0.3);

    // mean/temporalUniformity are each already the *output* of a noisy-OR combine() (mean is
    // an average of per-frame combine() results), so feeding them through combine() again
    // below double-applies the sensitivity dampening built into that formula. The ^0.7
    // curve compensates — pushes an already-strong aggregate score back up before it goes
    // through a second round of damping — without touching combine() itself, which is still
    // right for combining raw per-observation signals within a single frame.
    const boostedMean = clamp(mean ** 0.7);
    const boostedTemporal = clamp(temporalUniformity ** 0.7);

    const { score, signals } = combine([
      { key: 'Frame-level synthetic signals', weight: 0.6, value: boostedMean },
      // Bumped up from 0.15: this is video's one genuinely unique signal (image has no
      // temporal dimension at all), so it was underweighted relative to how much
      // independent evidence it actually carries.
      { key: 'Unnaturally consistent frames', weight: 0.3, value: boostedTemporal },
      ...meta
    ]);

    return {
      kind: 'video',
      score: clamp(score),
      verdict: verdict(score),
      signals: topSignals(signals).map((s) => s.key),
      framesSampled: frames.length
    };
  }

  self.RealViewVideoDetector = { analyze };
})();
