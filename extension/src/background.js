/* global chrome, importScripts, createImageBitmap, OffscreenCanvas */
importScripts('detect/pixels.js');

const { SAMPLE, statsFromImageData } = self.RealViewPixels;

// Refetched media is measured once per URL; the cache is bounded so a long
// browsing session cannot grow the worker's memory without limit.
const CACHE_LIMIT = 200;
const statsCache = new Map();

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
    await chrome.storage.sync.set({
      enabled: true,
      thresholds: { text: 0.55, image: 0.65, video: 0.5 }, // matches the "Balanced" preset in settings.js
      treatments: { text: 'blur', image: 'blur', video: 'warn' },
      disabledSites: [],
      showIndicator: true
    });
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

  if (message && message.type === 'realview:pixelStats') {
    measure(message.url).then((stats) => sendResponse({ stats }));
    return true;
  }

  return false;
});
