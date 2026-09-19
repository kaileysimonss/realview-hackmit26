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
    showIndicator: true,
    // Model analysis sends page content to a third party, so it stays off until
    // the user turns it on and supplies their own key.
    llmEnabled: false,
    llmProvider: 'openai',
    llmModel: '',
    llmMaxItems: 40
  };

  const PROVIDERS = {
    openai: { label: 'OpenAI', defaultModel: 'gpt-4o-mini' },
    anthropic: { label: 'Anthropic', defaultModel: 'claude-3-5-sonnet-latest' }
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

  // The API key lives in local storage only: chrome.storage.sync would push it
  // to every signed-in browser, and nothing outside the worker needs to read it.
  async function loadKey(provider) {
    const stored = await chrome.storage.local.get('llmKeys');
    const keys = (stored && stored.llmKeys) || {};
    return keys[provider] || '';
  }

  async function saveKey(provider, key) {
    const stored = await chrome.storage.local.get('llmKeys');
    const keys = { ...((stored && stored.llmKeys) || {}) };
    if (key) keys[provider] = key;
    else delete keys[provider];
    await chrome.storage.local.set({ llmKeys: keys });
  }

  function modelFor(settings) {
    const provider = PROVIDERS[settings.llmProvider] ? settings.llmProvider : 'openai';
    return settings.llmModel || PROVIDERS[provider].defaultModel;
  }

  function isSiteEnabled(settings, hostname) {
    return settings.enabled && !settings.disabledSites.includes(hostname);
  }

  self.RealViewSettings = {
    DEFAULTS,
    PROVIDERS,
    loadKey,
    saveKey,
    modelFor,
    TEXT_TREATMENTS,
    IMAGE_TREATMENTS,
    VIDEO_TREATMENTS,
    load,
    save,
    merge,
    isSiteEnabled
  };
})();
