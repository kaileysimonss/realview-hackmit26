(() => {
  const Settings = self.RealViewSettings;
  const KINDS = ['text', 'image', 'video'];
  const KIND_LABEL = { text: 'Text', image: 'Image', video: 'Video' };
  const KIND_TREATMENTS = {
    text: Settings.TEXT_TREATMENTS,
    image: Settings.IMAGE_TREATMENTS,
    video: Settings.VIDEO_TREATMENTS
  };

  const TREATMENT_CLASS = {
    blur: 'rv-treat-blur',
    strikethrough: 'rv-treat-strike',
    recolor: 'rv-treat-recolor',
    dim: 'rv-treat-dim',
    label: 'rv-treat-label',
    hide: 'rv-treat-hide',
    warn: 'rv-treat-warn',
    pause: 'rv-treat-pause'
  };

  const RISK_CLASS = (score) => {
    if (score >= 0.8) return 'rv-risk-high';
    if (score >= 0.6) return 'rv-risk-likely';
    return 'rv-risk-moderate';
  };

  const CAVEAT = {
    metadata:
      'Limited analysis: pixel data was unavailable, so this is based on metadata only. Detection signals are not proof.',
    poster:
      'Limited analysis: the video frames could not be read, so this scores the poster image instead. Detection signals are not proof.',
    full: 'Detection signals only. This is an estimate, not proof that the content was AI-generated.'
  };

  function buildBadge(el, result, onReveal) {
    const badge = document.createElement('div');
    badge.className = `rv-badge ${RISK_CLASS(result.score)}`;
    badge.setAttribute('data-realview', 'badge');

    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'rv-badge-summary';
    summary.setAttribute('aria-expanded', 'false');

    const summaryLabel = document.createElement('span');
    summaryLabel.className = 'rv-badge-label';
    summaryLabel.textContent = `RealView: ${result.verdict}`;

    const summaryArrow = document.createElement('span');
    summaryArrow.className = 'rv-badge-arrow';
    summaryArrow.setAttribute('aria-hidden', 'true');

    summary.append(summaryLabel, summaryArrow);

    const details = document.createElement('div');
    details.className = 'rv-badge-details';

    const signalList = document.createElement('ul');
    signalList.className = 'rv-signal-list';
    (result.signals.length ? result.signals : ['No individual signal dominated']).forEach((signal) => {
      const li = document.createElement('li');
      li.textContent = signal;
      signalList.appendChild(li);
    });

    const caveat = document.createElement('p');
    caveat.className = 'rv-caveat';
    caveat.textContent = CAVEAT[result.limited || 'full'] || CAVEAT.metadata;

    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.className = 'rv-reveal';
    reveal.textContent = 'Reveal temporarily';
    reveal.addEventListener('click', (event) => {
      // Media is often wrapped in a link; the badge must never navigate.
      event.preventDefault();
      event.stopPropagation();
      const revealed = el.classList.toggle('rv-revealed');
      reveal.textContent = revealed ? 'Hide again' : 'Reveal temporarily';
      onReveal(revealed);
    });

    details.append(signalList, caveat, reveal);
    summary.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = badge.classList.toggle('rv-open');
      summary.setAttribute('aria-expanded', String(open));
    });

    badge.append(summary, details);
    return badge;
  }

  function attach(el, result, treatment) {
    if (el.dataset.realviewHandled === '1') return;
    el.dataset.realviewHandled = '1';
    el.dataset.realviewScore = result.score.toFixed(2);
    el.classList.add('rv-item', TREATMENT_CLASS[treatment] || 'rv-treat-label');

    const isMedia = result.kind === 'image' || result.kind === 'video';
    const wasPlaying = result.kind === 'video' && !el.paused;

    const onReveal = (revealed) => {
      if (result.kind !== 'video') return;
      if (treatment === 'pause') {
        if (revealed) el.play().catch(() => {});
        else el.pause();
      }
    };

    if (treatment === 'pause' && result.kind === 'video') {
      el.pause();
    }

    const badge = buildBadge(el, result, onReveal);

    if (isMedia && isOutOfFlow(el)) {
      floatBadge(el, badge);
    } else if (isMedia) {
      wrapMedia(el).appendChild(badge);
    } else {
      el.parentNode.insertBefore(badge, el);
    }

    if (result.kind === 'video' && treatment !== 'pause' && wasPlaying) {
      el.play().catch(() => {});
    }
  }

  // Wrapping an out-of-flow element makes the wrapper its containing block and
  // collapses it to 0x0, so those badges float over the page instead.
  function isOutOfFlow(el) {
    const position = getComputedStyle(el).position;
    return position === 'absolute' || position === 'fixed';
  }

  const floated = new Map();
  let frameRequested = false;
  let layoutWatchers = null;

  function placeFloating() {
    frameRequested = false;
    floated.forEach((el, badge) => {
      if (!badge.isConnected || !el.isConnected) {
        badge.remove();
        floated.delete(badge);
        if (layoutWatchers) layoutWatchers.resize.unobserve(el);
        return;
      }
      // Only write when the value actually changes: the mutation observer below
      // watches style attributes, and unconditional writes would loop forever.
      const rect = el.getBoundingClientRect();
      const next = {
        visibility: rect.width && rect.height ? '' : 'hidden',
        top: `${rect.top + 8}px`,
        left: `${rect.left + 8}px`
      };
      Object.entries(next).forEach(([property, value]) => {
        if (badge.style[property] !== value) badge.style[property] = value;
      });
    });
  }

  function scheduleFloatingUpdate() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(placeFloating);
  }

  // Out-of-flow media also moves without scroll or resize events — collapsing
  // banners, carousels, late-loading content — so watch size and DOM changes too.
  function startLayoutWatchers() {
    if (layoutWatchers) return layoutWatchers;
    window.addEventListener('scroll', scheduleFloatingUpdate, { passive: true, capture: true });
    window.addEventListener('resize', scheduleFloatingUpdate, { passive: true });
    const resize = new ResizeObserver(scheduleFloatingUpdate);
    resize.observe(document.documentElement);
    const mutation = new MutationObserver(scheduleFloatingUpdate);
    mutation.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden']
    });
    layoutWatchers = { resize, mutation };
    return layoutWatchers;
  }

  function floatBadge(el, badge) {
    badge.classList.add('rv-badge-floating');
    document.body.appendChild(badge);
    floated.set(badge, el);
    startLayoutWatchers().resize.observe(el);
    placeFloating();
  }

  // The wrapper anchors the absolutely positioned badge; it must not change the
  // element's own layout, and repeated scans must not nest new wrappers.
  function wrapMedia(el) {
    const existing = el.parentElement;
    if (existing && existing.classList.contains('rv-wrap')) return existing;
    const wrap = document.createElement('span');
    wrap.className = 'rv-wrap';
    const display = getComputedStyle(el).display;
    wrap.style.display = display === 'inline' || display === 'inline-block' ? 'inline-block' : 'block';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    return wrap;
  }

  function unwrapMedia(wrap) {
    const parent = wrap.parentNode;
    if (!parent) return;
    while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
    parent.removeChild(wrap);
  }

  // The indicator panel keeps the latest render's data/callbacks here so event
  // listeners (bound once, at element creation) always act on fresh state.
  let currentState = null;
  let navIndex = -1;

  function severityClass(flagged, maxScore) {
    if (!flagged) return 'rv-indicator-clear';
    if (maxScore >= 0.8) return 'rv-indicator-high';
    if (maxScore >= 0.6) return 'rv-indicator-likely';
    return 'rv-indicator-moderate';
  }

  function highlightNavTarget(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const target = el.closest('.rv-wrap') || el;
    target.classList.remove('rv-nav-highlight');
    void target.offsetWidth; // restart the animation if the same element is hit twice in a row
    target.classList.add('rv-nav-highlight');
    setTimeout(() => target.classList.remove('rv-nav-highlight'), 1600);
  }

  function navigate(step) {
    const list = (currentState && currentState.flaggedElements) || [];
    if (!list.length) return;
    navIndex = ((navIndex + step) % list.length + list.length) % list.length;
    highlightNavTarget(list[navIndex]);
    renderNavPosition();
  }

  function renderNavPosition(node) {
    const root = node || document.getElementById('realview-indicator');
    if (!root) return;
    const list = (currentState && currentState.flaggedElements) || [];
    const position = root.querySelector('.rv-nav-position');
    const prevBtn = root.querySelector('.rv-nav-prev');
    const nextBtn = root.querySelector('.rv-nav-next');
    if (!list.length) {
      position.textContent = 'No flagged items';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }
    if (navIndex < 0 || navIndex >= list.length) navIndex = 0;
    position.textContent = `${navIndex + 1} of ${list.length}`;
    prevBtn.disabled = false;
    nextBtn.disabled = false;
  }

  function buildTreatmentSelect(kind) {
    const select = document.createElement('select');
    select.className = 'rv-quick-treatment';
    select.dataset.kind = kind;
    KIND_TREATMENTS[kind].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = Settings.TREATMENT_LABELS[value] || value;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      if (currentState && currentState.onTreatmentChange) {
        currentState.onTreatmentChange(kind, select.value);
      }
    });
    return select;
  }

  function buildIndicatorNode() {
    const node = document.createElement('div');
    node.id = 'realview-indicator';

    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'rv-indicator-summary';
    summary.setAttribute('aria-expanded', 'false');
    summary.innerHTML =
      '<span class="rv-indicator-ring" aria-hidden="true"></span>' +
      '<span class="rv-indicator-text"></span>' +
      '<span class="rv-indicator-arrow" aria-hidden="true"></span>';
    summary.addEventListener('click', () => {
      const open = node.classList.toggle('rv-open');
      summary.setAttribute('aria-expanded', String(open));
    });

    const panel = document.createElement('div');
    panel.className = 'rv-indicator-panel';

    const breakdown = document.createElement('div');
    breakdown.className = 'rv-indicator-breakdown';
    KINDS.forEach((kind) => {
      const row = document.createElement('div');
      row.className = 'rv-indicator-row';
      row.dataset.kind = kind;
      row.innerHTML = `<span class="rv-indicator-row-label">${KIND_LABEL[kind]}</span><span class="rv-indicator-row-count">0/0</span>`;
      breakdown.appendChild(row);
    });

    const nav = document.createElement('div');
    nav.className = 'rv-indicator-nav';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'rv-nav-prev';
    prevBtn.textContent = '‹ Prev';
    prevBtn.addEventListener('click', () => navigate(-1));
    const position = document.createElement('span');
    position.className = 'rv-nav-position';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'rv-nav-next';
    nextBtn.textContent = 'Next ›';
    nextBtn.addEventListener('click', () => navigate(1));
    nav.append(prevBtn, position, nextBtn);

    const actions = document.createElement('div');
    actions.className = 'rv-indicator-actions';

    const thresholdLabel = document.createElement('label');
    thresholdLabel.className = 'rv-quick-label';
    thresholdLabel.innerHTML = 'Sensitivity <span class="rv-quick-threshold-value"></span>';
    const threshold = document.createElement('input');
    threshold.type = 'range';
    threshold.className = 'rv-quick-threshold';
    threshold.min = '0';
    threshold.max = '1';
    threshold.step = '0.05';
    threshold.addEventListener('input', () => {
      thresholdLabel.querySelector('.rv-quick-threshold-value').textContent =
        `${Math.round(Number(threshold.value) * 100)}%`;
    });
    threshold.addEventListener('change', () => {
      if (currentState && currentState.onThresholdChange) {
        currentState.onThresholdChange(Number(threshold.value));
      }
    });

    const treatmentRow = document.createElement('div');
    treatmentRow.className = 'rv-quick-treatments';
    KINDS.forEach((kind) => {
      const label = document.createElement('label');
      label.className = 'rv-quick-label';
      label.textContent = KIND_LABEL[kind];
      label.appendChild(buildTreatmentSelect(kind));
      treatmentRow.appendChild(label);
    });

    const siteToggle = document.createElement('button');
    siteToggle.type = 'button';
    siteToggle.className = 'rv-quick-site-toggle';
    siteToggle.addEventListener('click', () => {
      if (currentState && currentState.onToggleSite) currentState.onToggleSite();
    });

    actions.append(thresholdLabel, threshold, treatmentRow, siteToggle);

    const note = document.createElement('p');
    note.className = 'rv-indicator-note';
    note.textContent = 'Visible page content only · analyzed locally';

    panel.append(breakdown, nav, actions, note);
    node.append(summary, panel);
    document.documentElement.appendChild(node);
    return node;
  }

  function indicator(state) {
    let node = document.getElementById('realview-indicator');
    if (!state.visible) {
      if (node) node.remove();
      currentState = null;
      navIndex = -1;
      return;
    }

    currentState = state;
    const isNew = !node;
    if (isNew) node = buildIndicatorNode();
    const wasOpen = !isNew && node.classList.contains('rv-open');

    node.querySelector('.rv-indicator-text').textContent = `${state.flagged} flagged · ${state.scanned} scanned`;

    const maxScore = state.maxScore || 0;
    node.className = severityClass(state.flagged, maxScore);
    if (wasOpen) node.classList.add('rv-open');
    node.querySelector('.rv-indicator-summary').setAttribute('aria-expanded', String(wasOpen));
    const ring = node.querySelector('.rv-indicator-ring');
    const ratio = state.scanned ? state.flagged / state.scanned : 0;
    ring.style.setProperty('--rv-ratio', ratio.toFixed(3));

    const byKind = state.byKind || {};
    KINDS.forEach((kind) => {
      const counts = byKind[kind] || { scanned: 0, flagged: 0 };
      const count = node.querySelector(`.rv-indicator-row[data-kind="${kind}"] .rv-indicator-row-count`);
      if (count) count.textContent = `${counts.flagged}/${counts.scanned}`;
    });

    renderNavPosition(node);

    const settings = state.settings;
    if (settings) {
      const thresholdInput = node.querySelector('.rv-quick-threshold');
      const thresholdValue = node.querySelector('.rv-quick-threshold-value');
      if (document.activeElement !== thresholdInput) thresholdInput.value = settings.threshold;
      thresholdValue.textContent = `${Math.round(settings.threshold * 100)}%`;

      KINDS.forEach((kind) => {
        const select = node.querySelector(`.rv-quick-treatment[data-kind="${kind}"]`);
        if (select && document.activeElement !== select) select.value = settings.treatments[kind];
      });

      const disabled = settings.disabledSites.includes(state.hostname);
      node.querySelector('.rv-quick-site-toggle').textContent = disabled
        ? `Enable on ${state.hostname}`
        : `Disable on ${state.hostname}`;
    }
  }

  self.RealViewPresentation = { attach, unwrapMedia, indicator, scheduleFloatingUpdate };
})();
