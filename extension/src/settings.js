/* global chrome */
(() => {
  const DEFAULTS = {
    enabled: true,
    threshold: 0.6,
    treatments: {
      text: 'blur',
      image: 'blur',
      video: 'warn'
    },
    disabledSites: [],
    showIndicator: true
  };

  const TEXT_TREATMENTS = ['blur', 'strikethrough', 'recolor', 'dim', 'label'];
  const IMAGE_TREATMENTS = ['blur', 'hide', 'warn', 'label'];
  const VIDEO_TREATMENTS = ['blur', 'pause', 'warn', 'label'];

  function merge(stored) {
    const settings = { ...DEFAULTS, ...(stored || {}) };
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

  self.RealViewSettings = {
    DEFAULTS,
    TEXT_TREATMENTS,
    IMAGE_TREATMENTS,
    VIDEO_TREATMENTS,
    load,
    save,
    merge,
    isSiteEnabled
  };
})();
