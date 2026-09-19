(() => {
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

  // Maps a raw measurement onto 0..1 with `low` -> 0 and `high` -> 1.
  const ramp = (value, low, high) => clamp((value - low) / (high - low));

  // Noisy-OR, not a weighted average: each signal is treated as independent evidence of
  // synthetic origin, and their "this signal does NOT indicate AI" probabilities are
  // multiplied rather than their values averaged. A plain weighted average gets dragged
  // toward the middle by every signal that ISN'T currently firing — real content rarely
  // trips every single signal at once, so genuinely suspicious content that fires 3-4 out
  // of 8 signals moderately still only averaged out to ~0.3-0.4, under most thresholds.
  // Multiplying survival probabilities means several moderate signals compound into real
  // confidence instead of being diluted by the signals sitting at zero.
  function combine(signals) {
    const active = signals.filter((s) => typeof s.value === 'number' && !Number.isNaN(s.value));
    if (!active.length) return { score: 0, signals: [] };
    const totalWeight = active.reduce((sum, s) => sum + s.weight, 0);
    if (!totalWeight) return { score: 0, signals: [] };
    const survival = active.reduce((product, s) => {
      // relativeWeight is scaled by active.length so it's ~1 for an "average weighted"
      // signal regardless of how many signal types this particular detector has — without
      // this, a detector with more signal types (e.g. text, 10 signals) dilutes every
      // individual signal's share more than one with fewer (e.g. image, 5-6 signals), making
      // it systematically harder to reach a high score for no reason other than having more
      // signal types defined. K and the cap were picked empirically against real/AI text
      // samples (see git history), not derived analytically.
      const relativeWeight = (s.weight / totalWeight) * active.length;
      const strength = clamp(clamp(s.value) * relativeWeight * 0.4, 0, 0.85);
      return product * (1 - strength);
    }, 1);
    return { score: clamp(1 - survival), signals: active };
  }

  function verdict(score) {
    if (score >= 0.8) return 'High likelihood of AI generation';
    if (score >= 0.6) return 'Likely AI-generated';
    if (score >= 0.4) return 'Possible synthetic content';
    return 'Weak detection signals';
  }

  // Signals are ordered by contribution so the reveal panel can show the top drivers.
  function topSignals(signals, limit = 3) {
    return [...signals]
      .sort((a, b) => b.weight * b.value - a.weight * a.value)
      .slice(0, limit)
      .filter((s) => s.value > 0.15);
  }

  self.RealViewSignals = { clamp, ramp, combine, verdict, topSignals };
})();
