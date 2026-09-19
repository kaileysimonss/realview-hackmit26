(() => {
  const { clamp, ramp, combine, verdict, topSignals } = self.RealViewSignals;
  const { pixelStats, remotePixelStats, scoreStats } = self.RealViewImageDetector;

  const NAME_HINTS =
    /(sora|runway|pika|veo|synthetic|deepfake|ai-?gen|generated|kling|hailuo|luma-?ai|seedance|wan2|grok-?imagine|midjourney)/i;
  // More samples steady out the per-frame average and the temporal-uniformity signal below;
  // 3 was thin enough that a single unusual frame could swing both.
  const FRAMES = 5;

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
        const { score, signals } = combine([
          { key: 'Poster-frame synthetic signals', weight: 0.6, value: scoreStats(poster).score },
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

    const frameScores = frames.map((stats) => scoreStats(stats).score);
    const mean = frameScores.reduce((a, b) => a + b, 0) / frameScores.length;

    // Generated clips tend to look uniformly "clean" frame to frame.
    const spread = Math.max(...frameScores) - Math.min(...frameScores);
    const temporalUniformity = 1 - ramp(spread, 0.02, 0.25);

    const { score, signals } = combine([
      { key: 'Frame-level synthetic signals', weight: 0.6, value: mean },
      { key: 'Unnaturally consistent frames', weight: 0.15, value: temporalUniformity },
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
