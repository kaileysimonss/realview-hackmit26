/* global chrome */
(async () => {
  const Settings = self.RealViewSettings;
  const LABELS = Settings.TREATMENT_LABELS;

  const els = {
    enabled: document.getElementById('enabled'),
    threshold: document.getElementById('threshold'),
    thresholdValue: document.getElementById('threshold-value'),
    text: document.getElementById('text-treatment'),
    image: document.getElementById('image-treatment'),
    video: document.getElementById('video-treatment'),
    hostname: document.getElementById('hostname'),
    siteToggle: document.getElementById('site-toggle'),
    indicator: document.getElementById('indicator')
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

  els.siteToggle.addEventListener('click', () => {
    if (!hostname) return;
    const disabled = settings.disabledSites.includes(hostname);
    const disabledSites = disabled
      ? settings.disabledSites.filter((site) => site !== hostname)
      : [...settings.disabledSites, hostname];
    update({ disabledSites });
  });
})();
