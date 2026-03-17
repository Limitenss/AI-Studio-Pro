// AI Studio Pro - Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ autocopy: false });
});
