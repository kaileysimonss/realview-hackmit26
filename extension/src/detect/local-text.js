/* global chrome */
(() => {
  const TAG = '[RealView/LocalTextModel]';
  const MAX_CHARS = 2000; // the tokenizer truncates anyway; this just bounds request size/latency

  // Returns the model's raw "ai" probability (0..1), or null if unavailable (message/offscreen
  // failure). text.js treats null as "no signal" and scores on its heuristics alone — see
  // text.js for why the raw value is calibrated before use rather than trusted directly.
  async function classify(rawText) {
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

    console.log(`${TAG} ← raw ai score ${response.score.toFixed(3)}`);
    return response.score;
  }

  self.RealViewLocalTextModel = { classify };
})();
