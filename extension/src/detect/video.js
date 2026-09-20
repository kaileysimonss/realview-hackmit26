(() => {
  const { clamp, ramp, combine, verdict, topSignals } = self.RealViewSignals;
  const { pixelStats, remotePixelStats } = self.RealViewImageDetector;

  const NAME_HINTS =
    /(sora|runway|pika|veo|synthetic|deepfake|ai-?gen|generated|kling|hailuo|luma-?ai|seedance|wan2|grok-?imagine|midjourney)/i;
  // More samples steady out the per-frame average and the temporal-uniformity signal below;
  // 3 was thin enough that a single unusual frame could swing both.
  const FRAMES = 5;
  // Matches image.js's FLAT_GRAPHIC_COLOR_LIMIT — see there for why.
  const FLAT_GRAPHIC_COLOR_LIMIT = 24;

  // These used to be image.js's thresholds pulled 15% toward the midpoint — an unvalidated
  // guess, explicitly flagged as such. Tested against 11 real videos (3 real camera footage,
  // 8 real AI-generated clips; Wikimedia Commons, held-out 60/40 split at the video level):
  // that guess scored AUC 0.167 — WORSE than random, because video frames (extracted from
  // compressed codecs mid-stream) behave differently from standalone JPEG stills. On real
  // video frame data, noise and edges are the OPPOSITE direction from image.js (real footage
  // had MORE noise/edge energy than the AI clips, not less — Cohen's d -0.80 / -0.62), and
  // noiseUniformity is also flipped from image's direction (d +1.98 — AI clips had more
  // uniform grain, matching the original hypothesis, but image's real-photo data pointed the
  // other way). saturation and tonalSpread agreed with image's direction and were the two
  // strongest signals here (d +2.23 / +0.88). Because the directions genuinely differ from
  // image's, video has its own scoring function below instead of reusing image.js's
  // scoreStats. Held-out test after this fix: 3/4 videos correctly ranked (up from what was
  // effectively anti-correlated before). n=11 videos total is still small — treat this as a
  // real, validated improvement in direction, not a precisely-measured final calibration.
  const VIDEO_THRESHOLDS = {
    noise: [0.0255, 0.0298], // LOW = suspicious (opposite of image.js)
    edges: [0.1022, 0.1081], // LOW = suspicious (opposite of image.js)
    saturation: [0.184, 0.47], // HIGH = suspicious (same as image.js)
    tonalSpread: [0.781, 0.845], // HIGH = suspicious (same as image.js)
    noiseUniformity: [0.329, 0.553] // HIGH = suspicious (opposite of image.js)
  };

  // IMPORTANT SCOPE LIMIT, confirmed on a second, larger, different real dataset: the numbers
  // above only work for whole-video generation (Sora/Grok/Seedance-style — the entire frame is
  // synthetic). They do NOT work for face-swap deepfakes (FaceForensics++-style — a real video
  // with just the face region replaced). Tested against 50 real videos (25 real, 25 face-swap
  // fakes; angads24/deepfake-video on Hugging Face, held-out 60/40 split): this exact formula
  // scored AUC 0.558 there — essentially chance, versus 0.917 on the whole-generation sample.
  // Per-signal effect sizes on face-swap data were also unstable across train/test splits (e.g.
  // noise flipped from Cohen's d +0.29 to -0.94), which is a sign of no real population-level
  // signal, not just a smaller effect. The likely reason: whole-frame noise/edge/saturation
  // averages are dominated by the mostly-real background, camera, and compression — a
  // face-swap only alters a small region, so it doesn't move the whole-frame statistics enough
  // to matter. Detecting THAT category would need face-region-specific analysis (face
  // detection, blend-boundary artifacts, temporal flicker localized to the face), which this
  // heuristic system doesn't have. Treat "detects whole-video AI generation, blind to
  // face-swap deepfakes" as a real, confirmed scope limit, not a bug to chase with more
  // threshold tuning — the second dataset's train/test instability already shows tuning won't
  // find a signal that isn't there.
  //
  // Also tried, also failed: two open-source ONNX image classifiers as a frame-level model
  // signal (the same integration pattern used for image.js's SMOGY model), tested against 28
  // frames sampled from the same face-swap dataset (14 real, 14 angads24/deepfake-video fakes,
  // different sample than the AUC-0.558 run above). onnx-community/Deep-Fake-Detector-v2-Model
  // (a ViT specifically marketed as a "deepfake detector") scored AUC 0.327 — worse than
  // chance, outputting uniformly high "Deepfake" confidence (0.75-0.85) regardless of ground
  // truth. image.js's own SMOGY model scored AUC 0.403 on the same frames — also worse than
  // chance, uniformly near-zero "artificial" confidence. Neither model transfers to this
  // domain (compressed, real-world-lit video frames of face-swap manipulation); both are
  // confidently wrong rather than usefully uncertain. No model signal was added to video's
  // frameScore()/combine() as a result — see conversation/commit history before re-attempting
  // with these two models specifically. A model actually trained on FaceForensics++-style
  // face-swap artifacts (e.g. HoopitAI's GenD models) might work, but isn't usable via
  // transformers.js: it ships custom PyTorch modeling code (`trust_remote_code`), not a
  // standard architecture transformers.js can load, and has no ONNX conversion available.

  function frameScore(stats) {
    return combine([
      { key: 'Elevated grain/noise', weight: 0.098, value: 1 - ramp(stats.noise, ...VIDEO_THRESHOLDS.noise) },
      { key: 'Dense fine-detail texture', weight: 0.076, value: 1 - ramp(stats.edges, ...VIDEO_THRESHOLDS.edges) },
      { key: 'Hyper-saturated palette', weight: 0.274, value: ramp(stats.saturation, ...VIDEO_THRESHOLDS.saturation) },
      { key: 'Wide tonal range', weight: 0.108, value: ramp(stats.tonalSpread, ...VIDEO_THRESHOLDS.tonalSpread) },
      {
        key: 'Uniform grain across the frame',
        weight: 0.243,
        value: stats.noiseUniformity == null ? undefined : ramp(stats.noiseUniformity, ...VIDEO_THRESHOLDS.noiseUniformity)
      }
    ]);
  }

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
        const posterScore = clamp(frameScore(poster).score ** 0.7);
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

    const frameScores = photographicFrames.map((stats) => frameScore(stats).score);
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
