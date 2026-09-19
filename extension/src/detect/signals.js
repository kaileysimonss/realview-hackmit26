(() => {
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

  // Maps a raw measurement onto 0..1 with `low` -> 0 and `high` -> 1.
  const ramp = (value, low, high) => clamp((value - low) / (high - low));

  function combine(signals) {
    const active = signals.filter((s) => typeof s.value === 'number' && !Number.isNaN(s.value));
    const totalWeight = active.reduce((sum, s) => sum + s.weight, 0);
    if (!totalWeight) return { score: 0, signals: [] };
    const score = active.reduce((sum, s) => sum + s.weight * clamp(s.value), 0) / totalWeight;
    return { score: clamp(score), signals: active };
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
