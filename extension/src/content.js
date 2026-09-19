/* global chrome */
(() => {
  const Settings = self.RealViewSettings;
  const Presentation = self.RealViewPresentation;
  const detectors = {
    text: self.RealViewTextDetector,
    image: self.RealViewImageDetector,
    video: self.RealViewVideoDetector
  };

  const TEXT_SELECTOR = 'p, li, blockquote, figcaption, [data-realview-block]';
  const SENSITIVE_SELECTOR =
    'input, textarea, select, form, [contenteditable=""], [contenteditable="true"]';
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE']);

  let settings = null;
  let observer = null;
  let scanScheduled = false;
  let scanning = false;

  // Element -> detection result, so threshold changes re-apply without re-analyzing.
  const results = new Map();
  const evaluated = new WeakSet();

  const isSensitive = (el) =>
    el.closest(SENSITIVE_SELECTOR) !== null || el.closest('[data-realview-exclude]') !== null;

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 12) return false;
    if (rect.bottom < -600 || rect.top > window.innerHeight + 1200) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  function eligible(el) {
    if (!el || evaluated.has(el) || SKIP_TAGS.has(el.tagName)) return false;
    if (el.closest('#realview-indicator, .rv-badge')) return false;
    if (isSensitive(el)) return false;
    return isVisible(el);
  }

  function collect(root) {
    const scope = root instanceof Element ? root : document.body;
    if (!scope) return { text: [], image: [], video: [] };
    const within = (selector) => [
      ...(scope.matches && scope.matches(selector) ? [scope] : []),
      ...scope.querySelectorAll(selector)
    ];

    return {
      text: within(TEXT_SELECTOR).filter(
        (el) => eligible(el) && !el.querySelector(TEXT_SELECTOR) && el.innerText.trim().length > 120
      ),
      image: within('img').filter(eligible),
      video: within('video').filter(eligible)
    };
  }

  function apply() {
    let flagged = 0;
    let maxScore = 0;
    const byKind = {
      text: { scanned: 0, flagged: 0 },
      image: { scanned: 0, flagged: 0 },
      video: { scanned: 0, flagged: 0 }
    };
    const flaggedElements = [];

    results.forEach((result, el) => {
      if (!el.isConnected) return;
      const counts = byKind[result.kind];
      if (counts) counts.scanned += 1;
      if (result.score < settings.threshold) return;
      flagged += 1;
      if (counts) counts.flagged += 1;
      if (result.score > maxScore) maxScore = result.score;
      flaggedElements.push(el);
      Presentation.attach(el, result, settings.treatments[result.kind]);
    });

    // Sort in document order so "next/prev flagged" moves the way the eye reads the page.
    flaggedElements.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const scanned = byKind.text.scanned + byKind.image.scanned + byKind.video.scanned;

    Presentation.indicator({
      visible: settings.showIndicator,
      scanned,
      flagged,
      byKind,
      maxScore,
      flaggedElements,
      settings,
      hostname: location.hostname,
      onThresholdChange: (value) => Settings.save({ threshold: value }),
      onTreatmentChange: (kind, value) =>
        Settings.save({ treatments: { ...settings.treatments, [kind]: value } }),
      onToggleSite: () => {
        const disabled = settings.disabledSites.includes(location.hostname);
        const disabledSites = disabled
          ? settings.disabledSites.filter((site) => site !== location.hostname)
          : [...settings.disabledSites, location.hostname];
        Settings.save({ disabledSites });
      }
    });
    chrome.runtime.sendMessage({ type: 'realview:stats', flagged }).catch(() => {});
  }

  async function analyze(el, kind) {
    evaluated.add(el);
    const detector = detectors[kind];
    const result = kind === 'text' ? detector.analyze(el.innerText) : await detector.analyze(el);
    if (result) results.set(el, result);
  }

  async function scan(root) {
    if (!settings || !Settings.isSiteEnabled(settings, location.hostname) || scanning) return;
    scanning = true;
    try {
      const batches = collect(root);
      for (const kind of ['text', 'image', 'video']) {
        for (const el of batches[kind]) await analyze(el, kind);
      }
      apply();
    } finally {
      scanning = false;
    }
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scan(document.body);
    }, 350);
  }

  function clearMarks() {
    document.querySelectorAll('.rv-badge').forEach((node) => node.remove());
    document.querySelectorAll('.rv-wrap').forEach((wrap) => Presentation.unwrapMedia(wrap));
    document.querySelectorAll('.rv-item').forEach((el) => {
      el.className = el.className
        .split(/\s+/)
        .filter((cls) => !cls.startsWith('rv-'))
        .join(' ')
        .trim();
      delete el.dataset.realviewHandled;
      delete el.dataset.realviewScore;
    });
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.addedNodes.length > 0)) scheduleScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', scheduleScan, { passive: true });
  }

  function teardown() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearMarks();
    Presentation.indicator({ visible: false, scanned: 0, flagged: 0 });
    chrome.runtime.sendMessage({ type: 'realview:stats', flagged: 0 }).catch(() => {});
  }

  async function refresh() {
    settings = await Settings.load();
    if (!Settings.isSiteEnabled(settings, location.hostname)) {
      teardown();
      return;
    }
    clearMarks();
    apply();
    startObserver();
    scheduleScan();
  }

  chrome.storage.onChanged.addListener(() => {
    refresh();
  });

  async function init() {
    settings = await Settings.load();
    if (!Settings.isSiteEnabled(settings, location.hostname)) return;
    await scan(document.body);
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
