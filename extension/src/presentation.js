(() => {
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

  function indicator(state) {
    let node = document.getElementById('realview-indicator');
    if (!state.visible) {
      if (node) node.remove();
      return;
    }
    if (!node) {
      node = document.createElement('div');
      node.id = 'realview-indicator';
      node.innerHTML =
        '<span class="rv-dot"></span><span class="rv-indicator-text"></span>' +
        '<span class="rv-indicator-note">Visible page content only · analyzed locally</span>';
      document.documentElement.appendChild(node);
    }
    node.querySelector('.rv-indicator-text').textContent =
      `RealView scanning · ${state.flagged} flagged of ${state.scanned}`;
  }

  self.RealViewPresentation = { attach, unwrapMedia, indicator, scheduleFloatingUpdate };
})();
