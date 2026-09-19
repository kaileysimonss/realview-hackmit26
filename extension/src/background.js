/* global chrome */
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  if (!stored || Object.keys(stored).length === 0) {
    await chrome.storage.sync.set({
      enabled: true,
      threshold: 0.6,
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
  }
  return false;
});
