(() => {
  const { ramp, clamp, combine, verdict, topSignals } = self.RealViewSignals;

  const STOCK_PHRASES = [
    'in today\u2019s fast-paced',
    'in today\'s fast-paced',
    'it is important to note',
    'it\u2019s important to note',
    'it\'s important to note',
    'delve into',
    'a testament to',
    'tapestry',
    'navigate the complexities',
    'in the ever-evolving',
    'plays a crucial role',
    'unlock the potential',
    'when it comes to',
    'the landscape of',
    'not only',
    'foster a sense of',
    'holistic approach',
    'seamlessly',
    'robust framework',
    'in conclusion',
    'furthermore',
    'moreover',
    'additionally',
    'leverage'
  ];

  const HUMAN_MARKERS = [
    'i ', 'we ', 'my ', 'honestly', 'lol', 'tbh', 'kinda', 'gonna', 'anyway',
    'weird', 'ugh', 'idk', 'yeah', '?!', '...'
  ];

  function sentences(text) {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function words(text) {
    return text.toLowerCase().match(/[a-z\u2019']+/g) || [];
  }

  function stdev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  function analyze(rawText) {
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

    const contractions = (lower.match(/\b\w+['\u2019](t|s|re|ve|ll|d|m)\b/g) || []).length;
    const contractionRate = contractions / Math.max(1, sentenceList.length);
    const formality = 1 - ramp(contractionRate, 0.05, 0.5);

    const humanHits = HUMAN_MARKERS.reduce((n, m) => (lower.includes(m) ? n + 1 : n), 0);
    const absentVoice = 1 - ramp(humanHits, 0, 4);

    const listy = (text.match(/(^|\s)(first|second|third|finally)[,:]/gi) || []).length;
    const scaffolding = ramp(listy, 0, 3);

    const { score, signals } = combine([
      { key: 'Uniform sentence rhythm', weight: 0.28, value: uniformity },
      { key: 'Low lexical variety', weight: 0.14, value: repetition },
      { key: 'Model-typical phrasing', weight: 0.24, value: stockPhrasing },
      { key: 'Consistently formal register', weight: 0.14, value: formality },
      { key: 'No personal or informal voice', weight: 0.12, value: absentVoice },
      { key: 'Templated structure', weight: 0.08, value: scaffolding }
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
