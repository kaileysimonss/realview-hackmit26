/* global chrome, importScripts, createImageBitmap, OffscreenCanvas */
importScripts('detect/pixels.js', 'settings.js', 'llm.js');

const { SAMPLE, statsFromImageData } = self.RealViewPixels;

// Refetched media is measured once per URL; the cache is bounded so a long
// browsing session cannot grow the worker's memory without limit.
const CACHE_LIMIT = 200;
const statsCache = new Map();

// The worker fetches with extension host permissions, so it only honours
// requests from a page's own content script, and only for web media URLs.
function fetchable(url, sender) {
  if (!sender.tab || !sender.url) return false;
  try {
    const target = new URL(url);
    const page = new URL(sender.url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
    return !(page.protocol === 'https:' && target.protocol === 'http:');
  } catch (err) {
    return false;
  }
}

async function measure(url) {
  if (statsCache.has(url)) return statsCache.get(url);

  let stats = null;
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (response.ok) {
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(SAMPLE, SAMPLE);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, SAMPLE, SAMPLE);
      const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);
      stats = statsFromImageData(data, bitmap.width, bitmap.height);
      bitmap.close();
    }
  } catch (err) {
    stats = null;
  }

  if (statsCache.size >= CACHE_LIMIT) {
    statsCache.delete(statsCache.keys().next().value);
  }
  statsCache.set(url, stats);
  return stats;
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  if (!stored || Object.keys(stored).length === 0) {
    await chrome.storage.sync.set(self.RealViewSettings.DEFAULTS);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'realview:stats' && sender.tab) {
    const count = Number(message.flagged) || 0;
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: count ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#7c3aed' });
    sendResponse({ ok: true });
    return false;
  }

  if (message && message.type === 'realview:llm' && sender.tab) {
    const request = message.request || {};
    const sources = (request.sources || []).filter(
      (source) => source.startsWith('data:image/') || fetchable(source, sender)
    );
    self.RealViewLLM.call({ ...request, sources })
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message && message.type === 'realview:pixelStats') {
    if (!fetchable(message.url, sender)) {
      sendResponse({ stats: null });
      return false;
    }
    measure(message.url).then((stats) => sendResponse({ stats }));
    return true;
  }

  return false;
});
