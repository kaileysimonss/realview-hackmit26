/* global chrome */
(async () => {
  const Settings = self.RealViewSettings;

  const LABELS = {
    blur: 'Blur',
    strikethrough: 'Strikethrough',
    recolor: 'Recolor',
    dim: 'Dim',
    label: 'Label only',
    hide: 'Hide',
    warn: 'Warning overlay',
    pause: 'Pause playback'
  };

  const els = {
    enabled: document.getElementById('enabled'),
    threshold: document.getElementById('threshold'),
    thresholdValue: document.getElementById('threshold-value'),
    text: document.getElementById('text-treatment'),
    image: document.getElementById('image-treatment'),
    video: document.getElementById('video-treatment'),
    hostname: document.getElementById('hostname'),
    siteToggle: document.getElementById('site-toggle'),
    indicator: document.getElementById('indicator'),
    llmEnabled: document.getElementById('llm-enabled'),
    llmProvider: document.getElementById('llm-provider'),
    llmModel: document.getElementById('llm-model'),
    llmKey: document.getElementById('llm-key'),
    llmStatus: document.getElementById('llm-status')
  };

  function fillOptions(select, options) {
    select.innerHTML = '';
    options.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = LABELS[value];
      select.appendChild(option);
    });
  }

  Object.entries(Settings.PROVIDERS).forEach(([value, { label }]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    els.llmProvider.appendChild(option);
  });

  fillOptions(els.text, Settings.TEXT_TREATMENTS);
  fillOptions(els.image, Settings.IMAGE_TREATMENTS);
  fillOptions(els.video, Settings.VIDEO_TREATMENTS);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let hostname = '';
  try {
    hostname = new URL(tab.url).hostname || new URL(tab.url).protocol;
  } catch (err) {
    hostname = '';
  }
  els.hostname.textContent = hostname || 'this page';

  let settings = await Settings.load();
  let key = await Settings.loadKey(settings.llmProvider);

  function renderLlm() {
    els.llmEnabled.checked = settings.llmEnabled;
    els.llmProvider.value = settings.llmProvider;
    els.llmModel.value = settings.llmModel;
    els.llmModel.placeholder = Settings.PROVIDERS[settings.llmProvider].defaultModel;
    els.llmKey.value = key;
    if (!settings.llmEnabled) {
      els.llmStatus.textContent = 'Off — scoring with on-device heuristics.';
    } else if (!key) {
      els.llmStatus.textContent = `Add an ${Settings.PROVIDERS[settings.llmProvider].label} key to use the model; heuristics run until then.`;
    } else {
      els.llmStatus.textContent = `Scoring with ${Settings.modelFor(settings)} · up to ${settings.llmMaxItems} items per page.`;
    }
  }

  function render() {
    els.enabled.checked = settings.enabled;
    els.threshold.value = settings.threshold;
    els.thresholdValue.textContent = `${Math.round(settings.threshold * 100)}%`;
    els.text.value = settings.treatments.text;
    els.image.value = settings.treatments.image;
    els.video.value = settings.treatments.video;
    els.indicator.checked = settings.showIndicator;
    const disabled = settings.disabledSites.includes(hostname);
    els.siteToggle.textContent = disabled ? 'Enable here' : 'Disable here';
    renderLlm();
  }

  async function update(patch) {
    settings = await Settings.save(patch);
    render();
  }

  render();

  els.enabled.addEventListener('change', () => update({ enabled: els.enabled.checked }));
  els.indicator.addEventListener('change', () => update({ showIndicator: els.indicator.checked }));
  els.threshold.addEventListener('input', () => {
    els.thresholdValue.textContent = `${Math.round(Number(els.threshold.value) * 100)}%`;
  });
  els.threshold.addEventListener('change', () => update({ threshold: Number(els.threshold.value) }));

  ['text', 'image', 'video'].forEach((kind) => {
    els[kind].addEventListener('change', () =>
      update({ treatments: { ...settings.treatments, [kind]: els[kind].value } })
    );
  });

  els.llmEnabled.addEventListener('change', () => update({ llmEnabled: els.llmEnabled.checked }));
  els.llmProvider.addEventListener('change', async () => {
    key = await Settings.loadKey(els.llmProvider.value);
    // The model name belongs to the old provider, so fall back to the new default.
    update({ llmProvider: els.llmProvider.value, llmModel: '' });
  });
  els.llmModel.addEventListener('change', () => update({ llmModel: els.llmModel.value.trim() }));
  els.llmKey.addEventListener('change', async () => {
    key = els.llmKey.value.trim();
    await Settings.saveKey(settings.llmProvider, key);
    renderLlm();
  });

  els.siteToggle.addEventListener('click', () => {
    if (!hostname) return;
    const disabled = settings.disabledSites.includes(hostname);
    const disabledSites = disabled
      ? settings.disabledSites.filter((site) => site !== hostname)
      : [...settings.disabledSites, hostname];
    update({ disabledSites });
  });
})();
