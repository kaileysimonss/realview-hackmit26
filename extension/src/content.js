/* global chrome */
(() => {
  const Settings = self.RealViewSettings;
  const Presentation = self.RealViewPresentation;
  const detectors = {
    // text.js combines its own pattern heuristics with a local RoBERTa classifier (run via an
    // offscreen document, relayed through the service worker — see local-text.js) as one more
    // signal. Watch the console for "[RealView/LocalTextModel]" — first call downloads the
    // ~120MB model. image.js follows the same heuristics+model pattern; video.js is
    // heuristics-only (see video.js for why).
    text: self.RealViewTextDetector,
    image: self.RealViewImageDetector,
    video: self.RealViewVideoDetector
  };

  const TEXT_SELECTOR =
    'p, li, blockquote, figcaption, h1, h2, h3, h4, h5, h6, dd, dt, td, th, div, span, [data-realview-block]';
  // Excludes `span`: an inline span nested inside a paragraph (a styled date, a highlighted
  // word, an inline link) is not a separate content block, so it must not disqualify its
  // parent from being treated as leaf content.
  const TEXT_BLOCK_SELECTOR =
    'p, li, blockquote, figcaption, h1, h2, h3, h4, h5, h6, dd, dt, td, th, div, [data-realview-block]';
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

  // Reloading the extension orphans any content script already injected into open tabs —
  // chrome.runtime.sendMessage then throws synchronously ("Extension context invalidated"),
  // which a trailing .catch() doesn't cover since no promise is ever returned. Harmless (the
  // tab just needs a refresh to pick up the new extension), so swallow it instead of an
  // uncaught error every time.
  function safeSendMessage(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch (err) {
      // context invalidated — nothing to do until the tab is refreshed
    }
  }

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

  // For each block candidate, mark the nearest block-candidate ancestor and stop: that
  // ancestor's own turn in the loop continues the chain up to *its* nearest ancestor, so
  // every wrapper still ends up marked without re-walking the same spine repeatedly. This
  // keeps the cost proportional to DOM depth per element instead of subtree size per element
  // (an `el.querySelector(...)` per candidate is O(n * subtree size) and can hang on real
  // pages with thousands of nested divs; this is O(n * depth)).
  function markBlockWrappers(blockCandidates) {
    const blockSet = new Set(blockCandidates);
    const hasBlockDescendant = new WeakSet();
    for (const el of blockCandidates) {
      let ancestor = el.parentElement;
      while (ancestor) {
        if (blockSet.has(ancestor)) {
          hasBlockDescendant.add(ancestor);
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }
    return hasBlockDescendant;
  }

  function collect(root) {
    const scope = root instanceof Element ? root : document.body;
    if (!scope) return { text: [], image: [], video: [] };
    const within = (selector) => [
      ...(scope.matches && scope.matches(selector) ? [scope] : []),
      ...scope.querySelectorAll(selector)
    ];

    const wrappers = markBlockWrappers(within(TEXT_BLOCK_SELECTOR));

    return {
      text: within(TEXT_SELECTOR).filter(
        // Leaf-only: a block containing another block-level match is a wrapper, not content
        // itself, so the inner match is what gets analyzed (nested inline spans don't count,
        // or every paragraph with a styled word inside it would get excluded as a "wrapper").
        // The char floor here is just a cheap pre-filter; text.js's own word-count gate does
        // the real cutoff.
        (el) => eligible(el) && !wrappers.has(el) && el.innerText.trim().length > 20
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
      if (result.score < settings.thresholds[result.kind]) return;
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
      onThresholdChange: (thresholds) => Settings.save({ thresholds }),
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
    safeSendMessage({ type: 'realview:stats', flagged });
  }

  async function analyze(el, kind) {
    evaluated.add(el);
    const detector = detectors[kind];
    // Awaiting unconditionally is safe even for the (currently unused) sync text detector —
    // await on a non-Promise value just resolves immediately.
    const result = await (kind === 'text' ? detector.analyze(el.innerText) : detector.analyze(el));
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
    safeSendMessage({ type: 'realview:stats', flagged: 0 });
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
