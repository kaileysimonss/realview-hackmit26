/* global chrome */
(() => {
  const TAG = '[RealView/LocalImageModel]';
  // The model resizes internally (224x224) regardless of what it's given; this just bounds
  // the data-URL payload size and inference cost without pre-distorting the aspect ratio the
  // way a naive stretch-to-224 would.
  const MAX_DIMENSION = 512;

  function toDataUrl(el) {
    const { naturalWidth: w, naturalHeight: h } = el;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9); // throws on a tainted (cross-origin, no-CORS) canvas
  }

  // Returns the model's "artificial" probability (0..1), or null if the model is unavailable
  // (cross-origin image, message/offscreen failure). image.js treats null as "no signal" and
  // falls back to the pixel heuristics alone rather than failing the whole analysis.
  async function classify(el) {
    let dataUrl;
    try {
      dataUrl = toDataUrl(el);
    } catch (err) {
      return null;
    }

    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'realview:classifyImage', dataUrl });
    } catch (err) {
      console.error(`${TAG} message error`, err);
      return null;
    }

    if (!response || typeof response.score !== 'number') {
      console.error(`${TAG} classification failed`, response && response.error);
      return null;
    }

    console.log(`${TAG} ← artificial score ${response.score.toFixed(3)}`);
    return response.score;
  }

  self.RealViewLocalImageModel = { classify };
})();
