/**
 * OA-ify Popup Controller (Bring Your Own Key)
 * Manages extension state, user API key, local storage, and tab communication.
 */
document.addEventListener('DOMContentLoaded', async () => {
  const masterToggle = document.getElementById('masterToggle');
  const autoOaToggle = document.getElementById('autoOaToggle');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const cacheCountEl = document.getElementById('cacheCount');
  const clearCacheBtn = document.getElementById('clearCacheBtn');

  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveKeyBtn = document.getElementById('saveKeyBtn');
  const toggleKeyVisibility = document.getElementById('toggleKeyVisibility');
  const eyeIcon = document.getElementById('eyeIcon');

  // Load saved preferences
  const storage = typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.sync || chrome.storage.local : null;
  const localStorage = typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : null;

  function updateStatusUI(isEnabled, hasKey) {
    if (!isEnabled) {
      statusBadge.classList.add('disabled');
      statusText.textContent = 'Disabled';
    } else if (!hasKey) {
      statusBadge.classList.remove('disabled');
      statusText.textContent = 'Key Needed';
      statusText.style.color = 'var(--accent-amber)';
    } else {
      statusBadge.classList.remove('disabled');
      statusText.textContent = 'Active';
      statusText.style.color = '';
    }
  }

  // Load settings
  let currentKey = '';
  let currentEnabled = true;

  if (storage) {
    storage.get(['oa_enabled', 'oa_auto_load', 'oa_api_key'], (res) => {
      currentEnabled = res.oa_enabled !== false; // Default true
      const autoLoad = res.oa_auto_load !== false; // Default true
      currentKey = res.oa_api_key || '';

      masterToggle.checked = currentEnabled;
      autoOaToggle.checked = autoLoad;

      if (currentKey) {
        apiKeyInput.value = currentKey;
      }

      updateStatusUI(currentEnabled, !!currentKey);
    });
  }

  // Save API Key
  saveKeyBtn.addEventListener('click', () => {
    const keyVal = apiKeyInput.value.trim();
    currentKey = keyVal;

    if (storage) {
      storage.set({ oa_api_key: keyVal }, () => {
        saveKeyBtn.textContent = 'Saved!';
        saveKeyBtn.style.borderColor = 'var(--accent-emerald)';
        saveKeyBtn.style.color = 'var(--accent-emerald)';

        updateStatusUI(masterToggle.checked, !!keyVal);

        setTimeout(() => {
          saveKeyBtn.textContent = 'Save API Key';
          saveKeyBtn.style.borderColor = '';
          saveKeyBtn.style.color = '';
        }, 1500);

        notifyActiveTab({
          type: 'OA_API_KEY_UPDATED',
          apiKey: keyVal
        });
      });
    }
  });

  // Toggle API Key visibility
  toggleKeyVisibility.addEventListener('click', () => {
    const isPass = apiKeyInput.type === 'password';
    apiKeyInput.type = isPass ? 'text' : 'password';
    eyeIcon.style.color = isPass ? 'var(--accent-amber)' : 'currentColor';
    const label = isPass ? 'Hide API key' : 'Show API key';
    toggleKeyVisibility.setAttribute('title', label);
    toggleKeyVisibility.setAttribute('aria-label', label);
    toggleKeyVisibility.setAttribute('aria-pressed', isPass ? 'true' : 'false');
  });

  // Count cached items
  async function refreshCacheCount() {
    if (!localStorage) return;
    localStorage.get(null, (items) => {
      const count = Object.keys(items || {}).filter(k => k.startsWith('lc_oa_')).length;
      cacheCountEl.textContent = count === 1 ? '1 cached' : `${count} cached`;
    });
  }
  await refreshCacheCount();

  // Clear cache handler
  clearCacheBtn.addEventListener('click', () => {
    if (!localStorage) return;
    localStorage.get(null, (items) => {
      const keysToRemove = Object.keys(items || {}).filter(k => k.startsWith('lc_oa_'));
      if (keysToRemove.length > 0) {
        localStorage.remove(keysToRemove, () => {
          refreshCacheCount();
          notifyActiveTab({ type: 'OA_CACHE_CLEARED' });
        });
      }
    });
  });

  // Toggle handlers
  masterToggle.addEventListener('change', () => {
    const isEnabled = masterToggle.checked;
    currentEnabled = isEnabled;
    updateStatusUI(isEnabled, !!currentKey);
    saveSetting('oa_enabled', isEnabled);
    notifyActiveTab({ type: 'OA_STATE_CHANGED', enabled: isEnabled });
  });

  autoOaToggle.addEventListener('change', () => {
    const autoLoad = autoOaToggle.checked;
    saveSetting('oa_auto_load', autoLoad);
    notifyActiveTab({ type: 'OA_AUTO_LOAD_CHANGED', autoLoad: autoLoad });
  });

  function saveSetting(key, val) {
    if (storage) {
      const update = {};
      update[key] = val;
      storage.set(update);
    }
  }

  function notifyActiveTab(msg) {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, msg, () => {
            // Ignore if content script is not loaded in current tab
            if (chrome.runtime.lastError) {
              /* ignore */
            }
          });
        }
      });
    }
  }
});
