document.addEventListener('DOMContentLoaded', () => {
  const autocopyToggle = document.getElementById('autocopy-toggle');

  // Load saved state
  chrome.storage.local.get(['autocopy'], (result) => {
    autocopyToggle.checked = result.autocopy || false;
  });

  // Save on change
  autocopyToggle.addEventListener('change', () => {
    chrome.storage.local.set({ autocopy: autocopyToggle.checked });
  });
});
