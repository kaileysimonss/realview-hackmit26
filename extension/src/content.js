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
  let rescanRequested = false;
  // Bumped whenever settings change, so a scan that is still awaiting media
  // cannot apply treatments the user has since turned off.
  let generation = 0;

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
    results.forEach((result, el) => {
      // Feeds discard old posts; keeping their elements as Map keys would retain
      // every detached subtree of a long session.
      if (!el.isConnected) {
        results.delete(el);
        return;
      }
      if (result.score < settings.threshold) return;
      flagged += 1;
      Presentation.attach(el, result, settings.treatments[result.kind]);
    });
    Presentation.indicator({
      visible: settings.showIndicator,
      scanned: results.size,
      flagged
    });
    chrome.runtime.sendMessage({ type: 'realview:stats', flagged }).catch(() => {});
  }

  async function analyze(el, kind) {
    evaluated.add(el);
    const detector = detectors[kind];
    const result = kind === 'text' ? detector.analyze(el.innerText) : await detector.analyze(el);
    if (result) results.set(el, result);
    else if (kind !== 'text') retryWhenLoaded(el, kind);
  }

  // Media that misses its readiness timeout yields no result, and its eventual
  // load fires no mutation, so re-open it for analysis when the bytes arrive.
  function retryWhenLoaded(el, kind) {
    el.addEventListener(
      kind === 'video' ? 'loadeddata' : 'load',
      () => {
        evaluated.delete(el);
        scheduleScan();
      },
      { once: true }
    );
  }

  async function scan(root) {
    if (!settings || !Settings.isSiteEnabled(settings, location.hostname)) return;
    if (scanning) {
      rescanRequested = true;
      return;
    }
    scanning = true;
    const token = generation;
    try {
      const batches = collect(root);
      for (const kind of ['text', 'image', 'video']) {
        for (const el of batches[kind]) {
          if (token !== generation) return;
          await analyze(el, kind);
        }
      }
      if (token !== generation) return;
      apply();
    } finally {
      scanning = false;
      if (rescanRequested) {
        rescanRequested = false;
        scheduleScan();
      }
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
    document.querySelectorAll('video[data-realview-paused="1"]').forEach((video) => {
      delete video.dataset.realviewPaused;
      video.play().catch(() => {});
    });
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
    generation += 1;
    rescanRequested = false;
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
    generation += 1;
    rescanRequested = false;
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
    // Observe first: the initial scan awaits media, and content appended during
    // that wait would otherwise never be seen.
    startObserver();
    await scan(document.body);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
