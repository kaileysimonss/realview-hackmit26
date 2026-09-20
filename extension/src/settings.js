/* global chrome */
(() => {
  const DEFAULTS = {
    enabled: true,
    // Per-kind, not one flat number. Text tested far more reliably than image (held-out AUC
    // 0.956 vs 0.741, and image has a confirmed false-positive issue on portraits — see
    // image.js), so it can afford to sit lower/more sensitive without the same false-positive
    // cost. Video has its own, lower/narrower range too: tested against 11 real videos (3 real
    // camera footage, 8 real AI-generated clips), scores landed around 0.39-0.45 for real and
    // 0.39-0.64 for AI — a much narrower band than image's, so image's threshold values would
    // give video near-zero recall. See video.js for the full validation (AUC 0.167 -> 0.917
    // after fixing signal directions that don't match image's). Matches "Balanced" below.
    thresholds: { text: 0.55, image: 0.65, video: 0.5 },
    treatments: {
      text: 'blur',
      image: 'blur',
      video: 'warn'
    },
    disabledSites: [],
    showIndicator: true
  };

  // Three fixed tolerance levels instead of a continuous slider — easier to reason about
  // than a raw percentage. Each preset sets per-kind thresholds rather than one shared value
  // (see DEFAULTS.thresholds above for why text differs from image/video).
  const THRESHOLD_PRESETS = [
    {
      id: 'sensitive',
      label: 'Sensitive',
      thresholds: { text: 0.4, image: 0.5, video: 0.4 },
      hint: 'Flags more, including borderline cases'
    },
    {
      id: 'balanced',
      label: 'Balanced',
      thresholds: { text: 0.55, image: 0.65, video: 0.5 },
      hint: 'Recommended default'
    },
    {
      id: 'strict',
      label: 'Strict',
      thresholds: { text: 0.7, image: 0.8, video: 0.6 },
      hint: 'Only confident, strong-signal flags'
    }
  ];

  const TEXT_TREATMENTS = ['blur', 'strikethrough', 'recolor', 'dim', 'label'];
  const IMAGE_TREATMENTS = ['blur', 'hide', 'warn', 'label'];
  const VIDEO_TREATMENTS = ['blur', 'pause', 'warn', 'label'];

  const TREATMENT_LABELS = {
    blur: 'Blur',
    strikethrough: 'Strikethrough',
    recolor: 'Recolor',
    dim: 'Dim',
    label: 'Label only',
    hide: 'Hide',
    warn: 'Warning overlay',
    pause: 'Pause playback'
  };

  function merge(stored) {
    const settings = { ...DEFAULTS, ...(stored || {}) };
    settings.thresholds = { ...DEFAULTS.thresholds, ...(stored && stored.thresholds) };
    settings.treatments = { ...DEFAULTS.treatments, ...(stored && stored.treatments) };
    settings.disabledSites = Array.isArray(settings.disabledSites) ? settings.disabledSites : [];
    return settings;
  }

  async function load() {
    const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
    return merge(stored);
  }

  async function save(patch) {
    const current = await load();
    const next = merge({ ...current, ...patch });
    await chrome.storage.sync.set(next);
    return next;
  }

  function isSiteEnabled(settings, hostname) {
    return settings.enabled && !settings.disabledSites.includes(hostname);
  }

  // Robust to stored thresholds that don't exactly match any preset (e.g. values saved by an
  // earlier version of the extension, before per-kind presets existed) — picks the preset
  // whose three values are closest overall, rather than matching none.
  function closestPreset(thresholds) {
    const distance = (preset) =>
      Object.keys(preset.thresholds).reduce(
        (sum, kind) => sum + Math.abs(preset.thresholds[kind] - (thresholds[kind] ?? preset.thresholds[kind])),
        0
      );
    return THRESHOLD_PRESETS.reduce((closest, preset) => (distance(preset) < distance(closest) ? preset : closest));
  }

  self.RealViewSettings = {
    DEFAULTS,
    THRESHOLD_PRESETS,
    TEXT_TREATMENTS,
    IMAGE_TREATMENTS,
    VIDEO_TREATMENTS,
    TREATMENT_LABELS,
    load,
    save,
    merge,
    isSiteEnabled,
    closestPreset
  };
})();
