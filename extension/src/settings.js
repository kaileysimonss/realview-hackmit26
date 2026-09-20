/* global chrome */
(() => {
  const DEFAULTS = {
    enabled: true,
    // Per-kind, not one flat number. Text (heuristics + a calibrated local model signal, the
    // model weighted at 0.3 — see text.js) reaches perfect separation on its 30-example
    // validation corpus (AUC 1.0, human max score 0.559 vs AI min 0.768), moved up from the old
    // heuristics-only value (0.55) to sit safely inside that gap. Image needs a higher
    // bar than text before flagging (held-out AUC 0.741, and a confirmed false-positive issue
    // on portraits AND texture-dense photography like wood grain/foliage — see image.js).
    // Image's threshold was raised from 0.65 to 0.75 after measuring that its false positives
    // cluster at 0.72-0.94 (a grid search over the signal weights found no reweighting improves
    // on the baseline — see image.js), which cuts the false-positive rate on the validation set
    // from 25% to 22.5% at real cost to recall (89%->76%); this is a real precision/recall
    // trade, not a free win — see image.js. Video has its own, lower/narrower range too: tested
    // against 11 real videos (3 real camera footage, 8 real AI-generated clips), scores landed
    // around 0.39-0.45 for real and 0.39-0.64 for AI — a much narrower band than image's, so
    // image's threshold values would give video near-zero recall. See video.js for the full
    // validation (AUC 0.167 -> 0.917 after fixing signal directions that don't match image's)
    // and for why video has no model signal (two candidates tested, both failed on real
    // face-swap data). Matches "Balanced" below.
    thresholds: { text: 0.65, image: 0.75, video: 0.5 },
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
      thresholds: { text: 0.45, image: 0.6, video: 0.4 },
      hint: 'Flags more, including borderline cases'
    },
    {
      id: 'balanced',
      label: 'Balanced',
      thresholds: { text: 0.65, image: 0.75, video: 0.5 },
      hint: 'Recommended default'
    },
    {
      id: 'strict',
      label: 'Strict',
      thresholds: { text: 0.7, image: 0.9, video: 0.6 },
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
