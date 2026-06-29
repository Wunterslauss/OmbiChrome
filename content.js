(() => {
  if (document.getElementById('ombi-chrome-container')) return;

  const site = detectSite();
  if (!site) return;

  waitForReady(site).then((info) => {
    if (info) injectButton(info);
  });

  function detectSite() {
    const host = location.hostname;
    if (host.includes('imdb.com')) return 'imdb';
    if (host.includes('yts.mx') || host.includes('yts.torrentbay')) return 'yify';
    return null;
  }

  function waitForReady(site) {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 30;

      function tryExtract() {
        attempts++;
        const info = extractInfo(site);
        if (info && info.title) {
          resolve(info);
        } else if (attempts < maxAttempts) {
          setTimeout(tryExtract, 500);
        } else {
          console.warn('OmbiChrome: could not extract title after', maxAttempts, 'attempts');
          resolve(null);
        }
      }

      tryExtract();
    });
  }

  function extractInfo(site) {
    if (site === 'imdb') return extractImdb();
    if (site === 'yify') return extractYify();
    return null;
  }

  function extractImdb() {
    const path = location.pathname;
    const imdbMatch = path.match(/\/title\/(tt\d+)/);
    if (!imdbMatch) return null;

    const imdbId = imdbMatch[1];

    const titleEl =
      document.querySelector('[data-testid="hero__pageTitle"] span') ||
      document.querySelector('[data-testid="hero__pageTitle"]') ||
      document.querySelector('h1[data-testid="hero__pageTitle"]') ||
      document.querySelector('.sc-afe43def-1') ||
      document.querySelector('h1 span') ||
      document.querySelector('h1');
    const title = titleEl ? titleEl.textContent.trim() : '';

    if (!title) return null;

    const pageText = document.body?.innerText?.substring(0, 5000) || '';
    const isTv = !!document.querySelector('[data-testid="episodes-header"]') ||
                 !!document.querySelector('a[href*="/episodes"]') ||
                 /TV Series|TV Mini.Series|TV Movie/i.test(pageText);

    return { title, imdbId, type: isTv ? 'series' : 'movie', source: 'imdb' };
  }

  function extractYify() {
    const path = location.pathname;
    if (!path.startsWith('/movies/') && !path.startsWith('/movie/')) return null;

    const titleEl =
      document.querySelector('#movie-info h1') ||
      document.querySelector('#movie-info h2') ||
      document.querySelector('.hidden-xs h1') ||
      document.querySelector('h1');
    const title = titleEl ? titleEl.textContent.trim() : '';

    if (!title) return null;

    let imdbId = '';
    const imdbLink = document.querySelector('a[href*="imdb.com/title/"]');
    if (imdbLink) {
      const m = imdbLink.href.match(/(tt\d+)/);
      if (m) imdbId = m[1];
    }

    return { title, imdbId, type: 'movie', source: 'yify' };
  }

  function injectButton(info) {
    if (document.getElementById('ombi-chrome-container')) return;

    const container = document.createElement('div');
    container.id = 'ombi-chrome-container';
    container.innerHTML = `
      <style>
        #ombi-chrome-container {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #ombi-chrome-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #dfa227;
          color: #1a1d23;
          border: none;
          border-radius: 12px;
          padding: 12px 20px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          transition: all 0.2s;
        }
        #ombi-chrome-btn:hover {
          background: #e8b445;
          transform: translateY(-2px);
          box-shadow: 0 6px 24px rgba(0,0,0,0.5);
        }
        #ombi-chrome-btn:disabled {
          background: #4a4d55;
          color: #8b949e;
          cursor: not-allowed;
          transform: none;
        }
        #ombi-chrome-btn.success {
          background: #238636;
          color: #fff;
        }
        #ombi-chrome-btn.error {
          background: #da3633;
          color: #fff;
        }
        #ombi-chrome-btn svg {
          width: 18px;
          height: 18px;
          fill: currentColor;
        }
      </style>
      <button id="ombi-chrome-btn">
        <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        <span>Add to Ombi</span>
      </button>
    `;
    document.body.appendChild(container);

    document.getElementById('ombi-chrome-btn').addEventListener('click', () => {
      requestToOmbi(info);
    });
  }

  async function requestToOmbi(info) {
    const btn = document.getElementById('ombi-chrome-btn');
    const label = btn.querySelector('span') || btn;
    btn.disabled = true;
    label.textContent = 'Searching...';

    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(['ombiUrl', 'ombiApiKey'], resolve);
    });

    if (!settings.ombiUrl || !settings.ombiApiKey) {
      showBtnState(btn, label, 'Configure Ombi in extension settings', 'error');
      return;
    }

    const baseUrl = settings.ombiUrl.replace(/\/+$/, '');

    try {
      const searchEndpoint = info.type === 'series'
        ? `/api/v1/Search/tv/${encodeURIComponent(info.title)}`
        : `/api/v1/Search/movie/${encodeURIComponent(info.title)}`;

      const searchResp = await fetch(`${baseUrl}${searchEndpoint}`, {
        headers: { 'ApiKey': settings.ombiApiKey },
      });
      const results = await searchResp.json();

      if (!Array.isArray(results) || results.length === 0) {
        showBtnState(btn, label, 'Not found on TMDB', 'error');
        return;
      }

      let match = null;
      if (info.imdbId) {
        match = results.find((r) => r.imdbId === info.imdbId);
      }
      if (!match) {
        match = results.find((r) =>
          r.title && r.title.toLowerCase() === info.title.toLowerCase()
        ) || results[0];
      }

      if (match.available || match.fullyAvailable) {
        showBtnState(btn, label, 'Already available', 'success');
        return;
      }
      if (match.approved) {
        showBtnState(btn, label, 'Already approved', 'success');
        return;
      }
      if (match.requested) {
        showBtnState(btn, label, 'Already requested', 'success');
        return;
      }

      const tmdbId = match.theMovieDbId || match.id;
      if (!tmdbId) {
        showBtnState(btn, label, 'No TMDB ID found', 'error');
        return;
      }

      label.textContent = 'Requesting...';

      const reqEndpoint = info.type === 'series'
        ? '/api/v1/Request/tv'
        : '/api/v1/Request/movie';

      const body = info.type === 'series'
        ? { theMovieDbId: tmdbId, requestAll: true }
        : { theMovieDbId: tmdbId };

      const reqResp = await fetch(`${baseUrl}${reqEndpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ApiKey': settings.ombiApiKey,
        },
        body: JSON.stringify(body),
      });

      const result = await reqResp.json();

      if (reqResp.ok && !result.isError) {
        showBtnState(btn, label, 'Requested!', 'success');
      } else {
        showBtnState(btn, label, result.errorMessage || result.message || 'Request failed', 'error');
      }
    } catch (err) {
      showBtnState(btn, label, `Error: ${err.message}`, 'error');
    }
  }

  function showBtnState(btn, label, text, cls) {
    label.textContent = text;
    btn.classList.remove('success', 'error');
    btn.classList.add(cls);
    btn.disabled = cls === 'success';
    if (cls === 'error') {
      setTimeout(() => {
        label.textContent = 'Add to Ombi';
        btn.classList.remove('error');
        btn.disabled = false;
      }, 3000);
    }
  }
})();
