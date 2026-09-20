/* global chrome */
(() => {
  const { clamp, verdict } = self.RealViewSignals;
  const TAG = '[RealView/LocalModel]';
  const MAX_CHARS = 2000; // the tokenizer truncates anyway; this just bounds request size/latency

  async function analyze(rawText) {
    const text = (rawText || '').replace(/\s+/g, ' ').trim();
    if (text.length < 20) return null;
    const sample = text.slice(0, MAX_CHARS);

    console.log(`${TAG} → classifying (${sample.length} chars, first call may take a while — ~120MB model download): "${sample.slice(0, 60)}..."`);

    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'realview:classifyText', text: sample });
    } catch (err) {
      console.error(`${TAG} message error`, err);
      return null;
    }

    if (!response || typeof response.score !== 'number') {
      console.error(`${TAG} classification failed`, response && response.error);
      return null;
    }

    console.log(`${TAG} ← ai score ${response.score.toFixed(3)}`);

    const score = clamp(response.score);
    return {
      kind: 'text',
      score,
      verdict: verdict(score),
      signals: [`Local RoBERTa (RAID-trained) AI-detection score: ${Math.round(score * 100)}%`],
      sampleSize: sample.length
    };
  }

  self.RealViewLocalTextDetector = { analyze };
})();
