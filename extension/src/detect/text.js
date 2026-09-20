(() => {
  const { ramp, clamp, combine, verdict, topSignals } = self.RealViewSignals;

  const STOCK_PHRASES = [
    'in today’s fast-paced',
    'in today\'s fast-paced',
    'it is important to note',
    'it’s important to note',
    'it\'s important to note',
    'it is worth noting',
    'it’s worth noting',
    'delve into',
    'deep dive',
    'dive into',
    'a testament to',
    'stands as a testament',
    'tapestry',
    'navigate the complexities',
    'in the ever-evolving',
    'in the realm of',
    'in the world of',
    'plays a crucial role',
    'plays a vital role',
    'plays a pivotal role',
    'cannot be overstated',
    'unlock the potential',
    'when it comes to',
    'the landscape of',
    'dynamic landscape',
    'not only',
    'foster a sense of',
    'holistic approach',
    'seamlessly',
    'seamless integration',
    'robust framework',
    'in conclusion',
    'in summary',
    'to sum up',
    'furthermore',
    'moreover',
    'additionally',
    'leverage',
    'harness the power',
    'empower',
    'elevate',
    'supercharge',
    'game-changing',
    'game changer',
    'cutting-edge',
    'trailblazer',
    'pave the way',
    'redefine',
    'revolutionize',
    'transformative',
    'multifaceted',
    'nuanced',
    'invaluable',
    'thought-provoking',
    'sheds light on',
    'underscores',
    'boasts an impressive',
    'at the end of the day',
    'in this day and age'
  ];

  const HUMAN_MARKERS = [
    'i ', 'we ', 'my ', 'honestly', 'lol', 'tbh', 'kinda', 'gonna', 'anyway',
    'weird', 'ugh', 'idk', 'yeah', '?!', '...'
  ];

  // Formal discourse markers opening a sentence are a much stronger tell than the word
  // appearing anywhere — real writers rarely open three-plus sentences in a short passage
  // with "Furthermore," / "Moreover," even if they'd use the word mid-sentence sometimes.
  const TRANSITION_STARTERS =
    /^(furthermore|moreover|additionally|however|therefore|thus|hence|notably|importantly|ultimately|indeed|in fact|overall|in conclusion|in summary)\b/i;

  // Rule-of-three listing ("fast, reliable, and efficient") is a real rhetorical device human
  // writers use too, so a single hit barely counts — it's specifically the OVERUSE of the
  // pattern (several in one short passage) that's a current, strong LLM tell.
  const TRIAD_PATTERN = /\b[\w-]+,\s+[\w-]+,?\s+and\s+[\w-]+\b/gi;

  function sentences(text) {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function words(text) {
    return text.toLowerCase().match(/[a-z’']+/g) || [];
  }

  function stdev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  // Exact repeated 3-word runs. Real writing repeats function-word trigrams ("in the
  // middle") but rarely repeats the same substantive phrase multiple times in a short
  // passage; some model output does, especially templated or lower-temperature generations.
  function trigramRepetition(wordList) {
    if (wordList.length < 12) return 0;
    const counts = new Map();
    for (let i = 0; i <= wordList.length - 3; i += 1) {
      const gram = `${wordList[i]} ${wordList[i + 1]} ${wordList[i + 2]}`;
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
    let repeated = 0;
    counts.forEach((count) => {
      if (count > 1) repeated += count - 1;
    });
    return repeated / Math.max(1, wordList.length - 2);
  }

  async function analyze(rawText) {
    const text = (rawText || '').replace(/\s+/g, ' ').trim();
    const wordList = words(text);
    if (wordList.length < 25) return null;

    const sentenceList = sentences(text);
    const lengths = sentenceList.map((s) => words(s).length).filter((n) => n > 0);
    const lower = text.toLowerCase();

    // Burstiness: human writing varies sentence length far more than model output.
    const burstiness = lengths.length > 2 ? stdev(lengths) : 8;
    const uniformity = 1 - ramp(burstiness, 2, 9);

    const uniqueRatio = new Set(wordList).size / wordList.length;
    const repetition = 1 - ramp(uniqueRatio, 0.55, 0.85);

    const phraseHits = STOCK_PHRASES.reduce((n, p) => (lower.includes(p) ? n + 1 : n), 0);
    const stockPhrasing = ramp(phraseHits, 0, 4);

    const contractions = (lower.match(/\b\w+['’](t|s|re|ve|ll|d|m)\b/g) || []).length;
    const contractionRate = contractions / Math.max(1, sentenceList.length);
    const formality = 1 - ramp(contractionRate, 0.05, 0.5);

    const humanHits = HUMAN_MARKERS.reduce((n, m) => (lower.includes(m) ? n + 1 : n), 0);
    const absentVoice = 1 - ramp(humanHits, 0, 4);

    const listy = (text.match(/(^|\s)(first|second|third|finally)[,:]/gi) || []).length;
    const scaffolding = ramp(listy, 0, 3);

    const transitionStarts = sentenceList.reduce(
      (n, s) => (TRANSITION_STARTERS.test(s.trim()) ? n + 1 : n),
      0
    );
    const transitionOveruse = ramp(transitionStarts, 1, 4);

    const repeatedPhrasing = ramp(trigramRepetition(wordList), 0, 0.08);

    // Modern LLMs (Claude/GPT-4-class) lean heavily on em dashes for asides far more than
    // typical human prose — measured per 100 words so it's comparable across passage lengths.
    const emDashes = (text.match(/[—]|--/g) || []).length;
    const emDashRate = emDashes / Math.max(1, wordList.length / 100);
    const emDashOveruse = ramp(emDashRate, 1, 5);

    const triadHits = (text.match(TRIAD_PATTERN) || []).length;
    const triadOveruse = ramp(triadHits, 1, 4);

    // Local RoBERTa classifier (run in the offscreen document — see local-text.js) added as ONE
    // more signal alongside these heuristics, not a replacement for them — same reasoning as
    // image.js's model integration: a bare model score has no explainable "why", so folding it
    // into this same combine() call keeps every flag traceable to named signals.
    //
    // Its RAW output can't be used directly, though: validated against a 30-example labeled
    // corpus (15 human, 15 AI; scratchpad eval/text_corpus.json), human text commonly scored
    // 0.85-0.98 raw "ai" probability — the model is severely overconfident in absolute terms
    // even though it ranks human vs AI almost perfectly (rank-only AUC 1.0 on that corpus). So
    // it's calibrated with its own ramp rather than trusted as a linear value: below 0.97 raw
    // counts as no evidence, scaling to full confidence at 0.985+. Weighted at 0.2 (below the
    // heaviest heuristic's 0.22) so a lone miscalibrated reading can't dominate the combined
    // score the way an earlier, higher weight did for the image model (see image.js history).
    // Combined this way, the same 30-example corpus separates perfectly (AUC 1.0, human max
    // 0.448 vs AI min 0.656) vs. AUC 0.956 for the heuristics alone — a real improvement, but
    // n=30 is a small sample, so treat this calibration as directionally solid, not precisely
    // final the way image's 79-example or video's 50-example validations were.
    const modelScoreRaw = await self.RealViewLocalTextModel.classify(text);
    const modelValue = modelScoreRaw == null ? undefined : ramp(modelScoreRaw, 0.97, 0.985);

    const { score, signals } = combine([
      { key: 'Uniform sentence rhythm', weight: 0.22, value: uniformity },
      { key: 'Low lexical variety', weight: 0.08, value: repetition },
      { key: 'Model-typical phrasing', weight: 0.18, value: stockPhrasing },
      { key: 'Consistently formal register', weight: 0.1, value: formality },
      { key: 'No personal or informal voice', weight: 0.08, value: absentVoice },
      { key: 'Templated structure', weight: 0.04, value: scaffolding },
      { key: 'Formal transitions open multiple sentences', weight: 0.14, value: transitionOveruse },
      { key: 'Repeated phrasing', weight: 0.08, value: repeatedPhrasing },
      { key: 'Heavy em dash use', weight: 0.16, value: emDashOveruse },
      { key: 'Rule-of-three listing', weight: 0.12, value: triadOveruse },
      { key: 'Local AI-text-detection model (RoBERTa)', weight: 0.2, value: modelValue }
    ]);

    // Short passages carry less evidence, so pull the score toward uncertainty.
    const confidence = clamp(0.6 + ramp(wordList.length, 25, 90) * 0.4);
    const adjusted = clamp(score * confidence);

    return {
      kind: 'text',
      score: adjusted,
      verdict: verdict(adjusted),
      signals: topSignals(signals).map((s) => s.key),
      sampleSize: wordList.length
    };
  }

  self.RealViewTextDetector = { analyze };
})();
