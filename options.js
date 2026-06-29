const $ = (s) => document.querySelector(s);

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['ombiUrl', 'ombiApiKey', 'omdbApiKey'], (data) => {
    $('#ombiUrl').value = data.ombiUrl || '';
    $('#ombiApiKey').value = data.ombiApiKey || '';
    $('#omdbApiKey').value = data.omdbApiKey || '';
  });

  $('#saveBtn').addEventListener('click', save);
  $('#testBtn').addEventListener('click', testConnection);
});

function showStatus(msg, type) {
  const el = $('#status');
  el.textContent = msg;
  el.className = `status ${type}`;
}

function save() {
  const ombiUrl = $('#ombiUrl').value.trim().replace(/\/+$/, '');
  const ombiApiKey = $('#ombiApiKey').value.trim();
  const omdbApiKey = $('#omdbApiKey').value.trim();

  if (!ombiUrl || !ombiApiKey) {
    showStatus('Ombi URL and API Key are required.', 'error');
    return;
  }

  try {
    const parsed = new URL(ombiUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      showStatus('URL must start with http:// or https://', 'error');
      return;
    }
  } catch {
    showStatus('Invalid URL format.', 'error');
    return;
  }

  try {
    const origin = new URL(ombiUrl).origin + '/*';
    chrome.permissions.request({ origins: [origin] }, (granted) => {
      chrome.storage.local.set({ ombiUrl, ombiApiKey, omdbApiKey }, () => {
        showStatus(granted ? 'Settings saved!' : 'Settings saved, but host permission was denied.', granted ? 'success' : 'error');
      });
    });
  } catch {
    chrome.storage.local.set({ ombiUrl, ombiApiKey, omdbApiKey }, () => {
      showStatus('Settings saved!', 'success');
    });
  }
}

async function testConnection() {
  const ombiUrl = $('#ombiUrl').value.trim().replace(/\/+$/, '');
  const ombiApiKey = $('#ombiApiKey').value.trim();

  if (!ombiUrl || !ombiApiKey) {
    showStatus('Enter Ombi URL and API Key first.', 'error');
    return;
  }

  showStatus('Testing...', 'success');

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(`${ombiUrl}/api/v1/Status`, {
      headers: { 'ApiKey': ombiApiKey },
      signal: controller.signal,
    });
    clearTimeout(tid);

    if (resp.ok) {
      showStatus('Connected to Ombi successfully!', 'success');
    } else if (resp.status === 401) {
      showStatus('Authentication failed — check your API key.', 'error');
    } else {
      showStatus(`Connection failed (HTTP ${resp.status}).`, 'error');
    }
  } catch (err) {
    showStatus(`Could not reach Ombi: ${err.message}`, 'error');
  }
}
