const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let allResults = [];
let activeFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  $('#searchBtn').addEventListener('click', doSearch);
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  $('#openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  $$('.filters button').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.filters button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderResults();
    });
  });

  detectCurrentPage();
});

function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['ombiUrl', 'ombiApiKey', 'omdbApiKey'], resolve);
  });
}

function showToast(message, type = 'info') {
  const container = $('#toasts');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function setStatus(msg, isError = false) {
  const container = $('#results');
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = `status-msg ${isError ? 'error' : ''}`;
  div.textContent = msg;
  container.appendChild(div);
}

function setLoading() {
  $('#results').innerHTML = `<div class="status-msg"><div class="spinner"></div><br>Searching...</div>`;
}

async function doSearch() {
  const query = $('#searchInput').value.trim();
  if (!query) return;

  const settings = await getSettings();
  if (!settings.ombiUrl || !settings.ombiApiKey) {
    showToast('Please configure Ombi settings first.', 'error');
    chrome.runtime.openOptionsPage();
    return;
  }

  $('#searchBtn').disabled = true;
  setLoading();
  allResults = [];

  const searches = [
    searchOmbiMovies(query, settings),
    searchOmbiTv(query, settings),
  ];
  if (settings.omdbApiKey) {
    searches.push(searchOmdb(query, settings.omdbApiKey));
  }
  searches.push(searchYify(query));

  try {
    const settled = await Promise.allSettled(searches);
    const combined = [];

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        combined.push(...result.value);
      } else {
        console.warn('Search source failed:', result.reason);
      }
    }

    allResults = deduplicateResults(combined);

    if (allResults.length === 0) {
      setStatus('No results found.');
    } else {
      renderResults();
    }
  } catch (err) {
    setStatus(`Search failed: ${err.message}`, true);
  } finally {
    $('#searchBtn').disabled = false;
  }
}

function hasMediaUrl(m) {
  return !!(m.plexUrl || m.embyUrl || m.jellyfinUrl);
}

function isAvailable(m) {
  return m.available === true && hasMediaUrl(m);
}

async function searchOmbiMovies(query, settings) {
  const baseUrl = settings.ombiUrl.replace(/\/+$/, '');
  const resp = await fetchWithTimeout(
    `${baseUrl}/api/v1/Search/movie/${encodeURIComponent(query)}`,
    { headers: { 'ApiKey': settings.ombiApiKey } }
  );
  if (!resp.ok) throw new Error(`Ombi movies HTTP ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data)) return [];
  return data.map((m) => ({
    title: m.title || '',
    year: (m.releaseDate || '').substring(0, 4),
    type: 'movie',
    poster: m.posterPath ? `https://image.tmdb.org/t/p/w200${m.posterPath}` : '',
    rating: m.voteAverage ? `${Math.round(m.voteAverage * 10) / 10}` : '',
    imdbId: m.imdbId || '',
    tmdbId: m.theMovieDbId || m.id || null,
    source: 'ombi',
    requested: m.requested || false,
    approved: m.approved || false,
    available: isAvailable(m),
    key: `tmdb-movie-${m.theMovieDbId || m.id || m.title}`,
  }));
}

async function searchOmbiTv(query, settings) {
  const baseUrl = settings.ombiUrl.replace(/\/+$/, '');
  const resp = await fetchWithTimeout(
    `${baseUrl}/api/v1/Search/tv/${encodeURIComponent(query)}`,
    { headers: { 'ApiKey': settings.ombiApiKey } }
  );
  if (!resp.ok) throw new Error(`Ombi TV HTTP ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data)) return [];
  return data.map((m) => ({
    title: m.title || '',
    year: (m.firstAired || '').substring(0, 4),
    type: 'series',
    poster: m.banner || (m.posterPath ? `https://image.tmdb.org/t/p/w200${m.posterPath}` : ''),
    rating: m.siteRating ? `${Math.round(m.siteRating * 10) / 10}` : '',
    imdbId: m.imdbId || '',
    tmdbId: m.theMovieDbId || m.id || null,
    source: 'ombi',
    requested: m.requested || false,
    approved: m.approved || false,
    available: isAvailable(m),
    key: `tmdb-tv-${m.theMovieDbId || m.id || m.title}`,
  }));
}

async function searchYify(query) {
  const urls = [
    `https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(query)}&limit=20`,
    `https://yts.torrentbay.st/api/v2/list_movies.json?query_term=${encodeURIComponent(query)}&limit=20`,
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const resp = await fetchWithTimeout(url);
      if (!resp.ok) { lastErr = new Error(`YIFY HTTP ${resp.status}`); continue; }
      const text = await resp.text();
      if (text.includes('<html')) { lastErr = new Error('YIFY blocked by ISP'); continue; }
      const data = JSON.parse(text);
      if (!data.data || !data.data.movies || data.data.movie_count === 0) return [];
      return data.data.movies.map((m) => ({
        title: m.title,
        year: String(m.year),
        type: 'movie',
        poster: m.medium_cover_image || '',
        rating: m.rating ? `${m.rating}` : '',
        imdbId: m.imdb_code || '',
        tmdbId: null,
        source: 'yify',
        requested: false,
        approved: false,
        available: false,
        key: (m.imdb_code || `yify-${m.title}-${m.year}`).toLowerCase(),
      }));
    } catch (err) {
      lastErr = err;
    }
  }
  console.warn('YIFY unavailable:', lastErr?.message);
  return [];
}

async function searchOmdb(query, apiKey) {
  const url = `https://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${encodeURIComponent(apiKey)}`;
  const resp = await fetchWithTimeout(url);
  const data = await resp.json();
  if (data.Response === 'False') return [];
  return data.Search.map((m) => ({
    title: m.Title,
    year: m.Year,
    type: m.Type === 'series' ? 'series' : 'movie',
    poster: m.Poster !== 'N/A' ? m.Poster : '',
    rating: '',
    imdbId: m.imdbID || '',
    tmdbId: null,
    source: 'imdb',
    requested: false,
    approved: false,
    available: false,
    key: (m.imdbID || `omdb-${m.Title}-${m.Year}`).toLowerCase(),
  }));
}

function deduplicateResults(results) {
  const seen = new Map();
  for (const r of results) {
    if (seen.has(r.key)) {
      const existing = seen.get(r.key);
      if (!existing.rating && r.rating) existing.rating = r.rating;
      if (!existing.poster && r.poster) existing.poster = r.poster;
      if (!existing.tmdbId && r.tmdbId) existing.tmdbId = r.tmdbId;
      if (r.requested) existing.requested = true;
      if (r.approved) existing.approved = true;
      if (r.available) existing.available = true;
      if (!existing.sources.includes(r.source)) existing.sources.push(r.source);
    } else {
      r.sources = [r.source];
      seen.set(r.key, r);
    }
  }
  return Array.from(seen.values());
}

function renderResults() {
  const filtered = activeFilter === 'all'
    ? allResults
    : allResults.filter((r) => r.type === activeFilter);

  if (filtered.length === 0) {
    setStatus(`No ${activeFilter === 'all' ? '' : activeFilter + ' '}results found.`);
    return;
  }

  $('#results').innerHTML = filtered.map((r, i) => {
    let btnLabel = 'Request';
    let btnClass = 'btn-request';
    let btnDisabled = '';
    if (r.available) { btnLabel = 'Available'; btnClass += ' requested'; btnDisabled = 'disabled'; }
    else if (r.requested) { btnLabel = 'Requested'; btnClass += ' requested'; btnDisabled = 'disabled'; }

    return `
    <div class="result-card">
      <img class="poster" src="${escapeAttr(r.poster)}" alt="" onerror="this.style.display='none'">
      <div class="info">
        <div class="title" title="${escapeAttr(r.title)}">${escapeHtml(r.title)}</div>
        <div class="meta">
          <span>${escapeHtml(r.year)}</span>
          ${r.rating ? `<span class="rating">${escapeHtml(r.rating)}</span>` : ''}
          <span class="badge ${r.type}">${r.type === 'series' ? 'TV' : 'Movie'}</span>
          ${r.sources.map((s) => `<span class="badge ${s}">${s}</span>`).join('')}
        </div>
      </div>
      <div class="actions">
        <button class="${btnClass}" data-key="${escapeAttr(r.key)}" onclick="requestTitle('${escapeAttr(r.key)}')" ${btnDisabled}>${btnLabel}</button>
      </div>
    </div>`;
  }).join('');
}

async function requestTitle(key) {
  const item = allResults.find((r) => r.key === key);
  if (!item) return;

  const btn = $(`.btn-request[data-key="${CSS.escape(key)}"]`);
  const settings = await getSettings();

  if (!settings.ombiUrl || !settings.ombiApiKey) {
    showToast('Configure Ombi in Settings first.', 'error');
    return;
  }

  if (item.type === 'series') {
    btn.disabled = true;
    btn.textContent = 'Loading...';
    try {
      let tmdbId = item.tmdbId;
      if (!tmdbId) tmdbId = await resolveToTmdbId(item, settings);
      if (!tmdbId) {
        showToast(`Could not find "${item.title}" on TMDB.`, 'error');
        btn.disabled = false;
        btn.textContent = 'Request';
        return;
      }
      await openSeasonPicker(item, tmdbId, settings, btn);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
      btn.disabled = false;
      btn.textContent = 'Request';
    }
    return;
  }

  btn.disabled = true;
  btn.textContent = '...';
  try {
    let tmdbId = item.tmdbId;
    if (!tmdbId) tmdbId = await resolveToTmdbId(item, settings);
    if (!tmdbId) {
      showToast(`Could not find TMDB ID for "${item.title}".`, 'error');
      btn.disabled = false;
      btn.textContent = 'Request';
      return;
    }
    await submitMovieRequest(tmdbId, item.title, settings, btn);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Request';
  }
}

async function submitMovieRequest(tmdbId, title, settings, btn) {
  const baseUrl = settings.ombiUrl.replace(/\/+$/, '');
  const resp = await fetchWithTimeout(`${baseUrl}/api/v1/Request/movie`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ApiKey': settings.ombiApiKey },
    body: JSON.stringify({ theMovieDbId: tmdbId }),
  });
  const result = await resp.json();
  if (resp.ok && !result.isError) {
    showToast(`"${title}" requested!`, 'success');
    btn.textContent = 'Requested';
    btn.classList.add('requested');
  } else {
    showToast(result.errorMessage || result.message || 'Request failed', 'error');
    btn.disabled = false;
    btn.textContent = 'Request';
  }
}

async function openSeasonPicker(item, tmdbId, settings, originBtn) {
  const baseUrl = settings.ombiUrl.replace(/\/+$/, '');
  const resp = await fetchWithTimeout(`${baseUrl}/api/v1/Search/tv/info/${tmdbId}`, {
    headers: { 'ApiKey': settings.ombiApiKey },
  });
  const showInfo = await resp.json();
  const seasons = showInfo.seasonRequests || [];

  if (seasons.length === 0) {
    showToast('No season info available.', 'error');
    originBtn.disabled = false;
    originBtn.textContent = 'Request';
    return;
  }

  const modal = $('#seasonModal');
  $('#modalTitle').textContent = item.title;

  const seasonList = $('#seasonList');
  seasonList.innerHTML = seasons.map((s) => {
    const allAvailable = s.episodes?.every((e) => e.available);
    const allRequested = s.episodes?.every((e) => e.requested || e.available);
    let statusHtml = '';
    if (allAvailable) statusHtml = '<span class="season-status available">Available</span>';
    else if (allRequested) statusHtml = '<span class="season-status requested">Requested</span>';

    return `
    <div class="season-item" data-season="${s.seasonNumber}">
      <div class="season-header">
        <input type="checkbox" class="season-check" data-season="${s.seasonNumber}" ${allAvailable ? 'disabled' : ''}>
        <span class="season-label">Season ${s.seasonNumber}</span>
        <span class="season-meta">${s.episodes?.length || 0} episodes</span>
        ${statusHtml}
        <button class="season-toggle" data-season="${s.seasonNumber}">&#9654;</button>
      </div>
      <div class="episode-list" id="eps-${s.seasonNumber}">
        ${(s.episodes || []).map((e) => `
          <div class="episode-item">
            <input type="checkbox" class="ep-check" data-season="${s.seasonNumber}" data-ep="${e.episodeNumber}" ${e.available ? 'checked disabled' : ''} ${e.requested ? 'checked disabled' : ''}>
            <label>E${String(e.episodeNumber).padStart(2, '0')} — ${escapeHtml(e.title || 'Episode ' + e.episodeNumber)}</label>
            ${e.available ? '<span class="ep-status">Available</span>' : e.requested ? '<span class="ep-status" style="color:#8b949e">Requested</span>' : ''}
          </div>
        `).join('')}
      </div>
    </div>`;
  }).join('');

  modal.style.display = 'flex';
  originBtn.disabled = false;
  originBtn.textContent = 'Request';

  const updateSelectedBtn = () => {
    const checked = seasonList.querySelectorAll('.ep-check:checked:not(:disabled)');
    const seasonChecked = seasonList.querySelectorAll('.season-check:checked:not(:disabled)');
    const count = checked.length + seasonChecked.length;
    const reqSelBtn = $('#reqSelected');
    reqSelBtn.disabled = count === 0;
    reqSelBtn.textContent = count > 0 ? `Request Selected (${checked.length + countSeasonEps(seasonChecked, seasons)})` : 'Request Selected';
  };

  seasonList.querySelectorAll('.season-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sn = btn.dataset.season;
      const epList = $(`#eps-${sn}`);
      epList.classList.toggle('open');
      btn.classList.toggle('open');
    });
  });

  seasonList.querySelectorAll('.season-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const sn = cb.dataset.season;
      const epChecks = seasonList.querySelectorAll(`.ep-check[data-season="${sn}"]:not(:disabled)`);
      epChecks.forEach((ep) => { ep.checked = cb.checked; });
      updateSelectedBtn();
    });
  });

  seasonList.querySelectorAll('.ep-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const sn = cb.dataset.season;
      const seasonCb = seasonList.querySelector(`.season-check[data-season="${sn}"]`);
      const epChecks = seasonList.querySelectorAll(`.ep-check[data-season="${sn}"]:not(:disabled)`);
      const allChecked = Array.from(epChecks).every((e) => e.checked);
      if (seasonCb && !seasonCb.disabled) seasonCb.checked = allChecked;
      updateSelectedBtn();
    });
  });

  const cleanup = () => {
    modal.style.display = 'none';
    $('#reqAll').replaceWith($('#reqAll').cloneNode(true));
    $('#reqLatest').replaceWith($('#reqLatest').cloneNode(true));
    $('#reqSelected').replaceWith($('#reqSelected').cloneNode(true));
    $('#modalClose').replaceWith($('#modalClose').cloneNode(true));
    modal.replaceWith(modal.cloneNode(true));
  };

  $('#modalClose').addEventListener('click', cleanup);
  modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); });

  $('#reqAll').addEventListener('click', async () => {
    cleanup();
    await submitTvRequest(tmdbId, item.title, settings, { requestAll: true }, originBtn);
  });

  $('#reqLatest').addEventListener('click', async () => {
    cleanup();
    await submitTvRequest(tmdbId, item.title, settings, { latestSeason: true }, originBtn);
  });

  $('#reqSelected').addEventListener('click', async () => {
    const selectedSeasons = buildSelectedSeasons(seasonList, seasons);
    if (selectedSeasons.length === 0) return;
    cleanup();
    await submitTvRequest(tmdbId, item.title, settings, { seasons: selectedSeasons }, originBtn);
  });
}

function countSeasonEps(seasonChecks, seasons) {
  let count = 0;
  seasonChecks.forEach((cb) => {
    const s = seasons.find((s) => s.seasonNumber === parseInt(cb.dataset.season));
    if (s) count += (s.episodes || []).filter((e) => !e.available && !e.requested).length;
  });
  return count;
}

function buildSelectedSeasons(seasonList, seasons) {
  const result = [];
  for (const s of seasons) {
    const seasonCb = seasonList.querySelector(`.season-check[data-season="${s.seasonNumber}"]`);
    if (seasonCb && seasonCb.checked && !seasonCb.disabled) {
      result.push({
        seasonNumber: s.seasonNumber,
        episodes: (s.episodes || []).filter((e) => !e.available && !e.requested).map((e) => ({ episodeNumber: e.episodeNumber })),
      });
      continue;
    }
    const checkedEps = seasonList.querySelectorAll(`.ep-check[data-season="${s.seasonNumber}"]:checked:not(:disabled)`);
    if (checkedEps.length > 0) {
      result.push({
        seasonNumber: s.seasonNumber,
        episodes: Array.from(checkedEps).map((cb) => ({ episodeNumber: parseInt(cb.dataset.ep) })),
      });
    }
  }
  return result;
}

async function submitTvRequest(tvDbId, title, settings, options, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  const baseUrl = settings.ombiUrl.replace(/\/+$/, '');
  const body = {
    tvDbId,
    requestAll: options.requestAll || false,
    latestSeason: options.latestSeason || false,
    firstSeason: false,
    seasons: options.seasons || [],
  };

  try {
    const resp = await fetchWithTimeout(`${baseUrl}/api/v1/Request/tv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ApiKey': settings.ombiApiKey },
      body: JSON.stringify(body),
    });
    const result = await resp.json();
    if (resp.ok && !result.isError) {
      showToast(`"${title}" requested!`, 'success');
      btn.textContent = 'Requested';
      btn.classList.add('requested');
    } else {
      showToast(result.errorMessage || result.message || 'Request failed', 'error');
      btn.disabled = false;
      btn.textContent = 'Request';
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Request';
  }
}

async function resolveToTmdbId(item, settings) {
  const baseUrl = settings.ombiUrl.replace(/\/+$/, '');
  const endpoint = item.type === 'series'
    ? '/api/v1/Search/tv'
    : '/api/v1/Search/movie';

  try {
    const resp = await fetchWithTimeout(
      `${baseUrl}${endpoint}/${encodeURIComponent(item.title)}`,
      { headers: { 'ApiKey': settings.ombiApiKey } }
    );
    const results = await resp.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    if (item.imdbId) {
      const infoType = item.type === 'series' ? 'tv' : 'movie';
      for (const r of results) {
        const rid = r.theMovieDbId || r.id;
        if (!rid) continue;
        try {
          const infoResp = await fetchWithTimeout(
            `${baseUrl}/api/v1/Search/${infoType}/info/${rid}`,
            { headers: { 'ApiKey': settings.ombiApiKey } }
          );
          const detail = await infoResp.json();
          if (detail.imdbId === item.imdbId) return rid;
        } catch {}
      }
    }

    const yearMatch = results.find(
      (r) => r.title?.toLowerCase() === item.title.toLowerCase() && String(r.releaseDate || r.firstAired || '').startsWith(item.year)
    );

    return (yearMatch || results[0]).id || (yearMatch || results[0]).theMovieDbId || null;
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function runScript(tabId, func) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func });
  return results?.[0]?.result || null;
}

function cleanTabTitle(title, ...patterns) {
  if (!title) return '';
  let cleaned = title;
  for (const p of patterns) cleaned = cleaned.replace(p, '');
  return cleaned.trim();
}

async function detectCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const url = tab.url;
    let info = null;

    const detectors = [
      {
        name: 'IMDB',
        test: () => url.match(/imdb\.com\/title\/(tt\d+)/),
        extract: async (m) => {
          let title = '';
          let isTv = false;
          const imdbId = m[1];
          try {
            const r = await runScript(tab.id, () => {
              const el = document.querySelector('[data-testid="hero__pageTitle"] span') ||
                document.querySelector('[data-testid="hero__pageTitle"]') ||
                document.querySelector('h1 span') || document.querySelector('h1');
              const t = el ? el.textContent.trim() : '';
              const tv = !!document.querySelector('[data-testid="episodes-header"]') ||
                !!document.querySelector('a[href*="/episodes"]') ||
                /TV Series|TV Mini.Series/i.test((document.body?.innerText || '').substring(0, 5000));
              return { title: t, isTv: tv };
            });
            if (r?.title) { title = r.title; isTv = r.isTv; }
          } catch {}
          if (!title) {
            title = cleanTabTitle(tab.title, /\s*[-|].*IMDb.*$/i, /\s*\(\d{4}\)\s*$/);
            if (tab.title && /TV Series|TV Mini/i.test(tab.title)) isTv = true;
          }
          return title ? { title, imdbId, type: isTv ? 'series' : 'movie' } : null;
        },
      },
      {
        name: 'YIFY',
        test: () => url.match(/yts\.\w+\/movies?\//),
        extract: async () => {
          let title = '', imdbId = '';
          try {
            const r = await runScript(tab.id, () => {
              const el = document.querySelector('#movie-info h1') || document.querySelector('#movie-info h2') ||
                document.querySelector('.hidden-xs h1') || document.querySelector('h1');
              const t = el ? el.textContent.trim() : '';
              const link = document.querySelector('a[href*="imdb.com/title/"]');
              let id = ''; if (link) { const m = link.href.match(/(tt\d+)/); if (m) id = m[1]; }
              return { title: t, imdbId: id };
            });
            if (r?.title) { title = r.title; imdbId = r.imdbId; }
          } catch {}
          if (!title) title = cleanTabTitle(tab.title, /\s*[-|].*YTS.*$/i, /\s*\(\d{4}\)\s*$/);
          return title ? { title, imdbId, type: 'movie' } : null;
        },
      },
      {
        name: 'TMDB',
        test: () => url.match(/themoviedb\.org\/(movie|tv)\/(\d+)/),
        extract: async (m) => {
          const type = m[1] === 'tv' ? 'series' : 'movie';
          let title = cleanTabTitle(tab.title, /\s*[-—].*The Movie Database.*$/i, /\s*\(TMDB\)\s*$/i, /\s*\(\d{4}\)\s*$/);
          if (!title) {
            try {
              const r = await runScript(tab.id, () => {
                const el = document.querySelector('.title h2 a') || document.querySelector('h2 a') || document.querySelector('h2');
                return el ? el.textContent.trim() : '';
              });
              if (r) title = r;
            } catch {}
          }
          return title ? { title, imdbId: '', type } : null;
        },
      },
      {
        name: 'Rotten Tomatoes',
        test: () => url.match(/rottentomatoes\.com\/(m|tv)\/[^/]+/),
        extract: async (m) => {
          const type = m[1] === 'tv' ? 'series' : 'movie';
          let title = cleanTabTitle(tab.title, /\s*[-|–].*Rotten Tomatoes.*$/i, /\s*\(\d{4}\)\s*$/);
          if (!title) {
            try {
              const r = await runScript(tab.id, () => {
                const el = document.querySelector('h1.title') || document.querySelector('[data-qa="score-panel-title"]') || document.querySelector('h1');
                return el ? el.textContent.trim() : '';
              });
              if (r) title = r;
            } catch {}
          }
          return title ? { title, imdbId: '', type } : null;
        },
      },
      {
        name: 'Letterboxd',
        test: () => url.match(/letterboxd\.com\/film\/[^/]+/),
        extract: async () => {
          let title = cleanTabTitle(tab.title, /\s*[-—].*Letterboxd.*$/i, /\s*\(\d{4}\)\s*$/);
          if (!title) {
            try {
              const r = await runScript(tab.id, () => {
                const el = document.querySelector('h1.headline-1') || document.querySelector('[itemprop="name"]') || document.querySelector('h1');
                return el ? el.textContent.trim() : '';
              });
              if (r) title = r;
            } catch {}
          }
          return title ? { title, imdbId: '', type: 'movie' } : null;
        },
      },
      {
        name: 'Trakt',
        test: () => url.match(/trakt\.tv\/(movies|shows)\/[^/]+/),
        extract: async (m) => {
          const type = m[1] === 'shows' ? 'series' : 'movie';
          let title = cleanTabTitle(tab.title, /\s*[-—|].*Trakt.*$/i, /\s*\(\d{4}\)\s*$/);
          if (!title) {
            try {
              const r = await runScript(tab.id, () => {
                const el = document.querySelector('h1') || document.querySelector('.summary h1');
                return el ? el.textContent.trim() : '';
              });
              if (r) title = r;
            } catch {}
          }
          return title ? { title, imdbId: '', type } : null;
        },
      },
      {
        name: 'JustWatch',
        test: () => url.match(/justwatch\.com\/[^/]+\/(movie|tv-show)\/[^/]+/),
        extract: async (m) => {
          const type = m[1] === 'tv-show' ? 'series' : 'movie';
          let title = cleanTabTitle(tab.title, /\s*[-—|].*JustWatch.*$/i, /\s*[-—|].*Stream.*$/i, /\s*\(\d{4}\)\s*$/);
          if (!title) {
            try {
              const r = await runScript(tab.id, () => {
                const el = document.querySelector('h1') || document.querySelector('[class*="title-block"] h1');
                return el ? el.textContent.trim() : '';
              });
              if (r) title = r;
            } catch {}
          }
          return title ? { title, imdbId: '', type } : null;
        },
      },
      {
        name: 'Metacritic',
        test: () => url.match(/metacritic\.com\/(movie|tv)\/[^/]+/),
        extract: async (m) => {
          const type = m[1] === 'tv' ? 'series' : 'movie';
          let title = cleanTabTitle(tab.title, /\s*[-—|].*Metacritic.*$/i, /\s*Reviews?\s*$/i, /\s*\(\d{4}\)\s*$/);
          if (!title) {
            try {
              const r = await runScript(tab.id, () => {
                const el = document.querySelector('h1') || document.querySelector('[class*="product_title"]');
                return el ? el.textContent.trim() : '';
              });
              if (r) title = r;
            } catch {}
          }
          return title ? { title, imdbId: '', type } : null;
        },
      },
      {
        name: '1337x',
        test: () => url.match(/1337x\.\w+\/torrent\//),
        extract: async () => {
          let title = cleanTabTitle(tab.title, /\s*[-|].*1337x.*$/i, /\s*torrent.*$/i);
          if (title) title = title.replace(/\.\d{4}\..*$/i, '').replace(/\./g, ' ').trim();
          return title ? { title, imdbId: '', type: 'movie' } : null;
        },
      },
    ];

    for (const det of detectors) {
      const m = det.test();
      if (m) {
        const result = await det.extract(m);
        if (result) {
          info = { ...result, source: det.name };
          break;
        }
      }
    }

    if (!info) return;

    const bar = $('#detected');
    const btn = $('#detectedBtn');
    $('#detectedTitle').textContent = info.title;
    $('#detectedMeta').textContent = `${info.type === 'series' ? 'TV Show' : 'Movie'} — via ${info.source}${info.imdbId ? ' (' + info.imdbId + ')' : ''}`;
    bar.style.display = 'flex';

    const settings = await getSettings();
    if (settings.ombiUrl && settings.ombiApiKey) {
      btn.disabled = true;
      btn.textContent = 'Checking...';
      const status = await checkOmbiStatus(info, settings);
      info._tmdbId = status.tmdbId;
      if (status.available) {
        btn.textContent = 'Already available';
        btn.classList.add('success');
        return;
      } else if (status.requested && info.type !== 'series') {
        btn.textContent = 'Already requested';
        btn.classList.add('success');
        return;
      } else {
        btn.disabled = false;
        btn.textContent = 'Add to Ombi';
      }
    }

    btn.addEventListener('click', () => requestDetected(info), { once: true });
  } catch (err) {
    console.warn('OmbiChrome: page detection failed:', err);
  }
}

async function checkOmbiStatus(info, settings) {
  const baseUrl = settings.ombiUrl.replace(/\/+$/, '');
  const endpoint = info.type === 'series'
    ? `/api/v1/Search/tv/${encodeURIComponent(info.title)}`
    : `/api/v1/Search/movie/${encodeURIComponent(info.title)}`;

  try {
    const resp = await fetchWithTimeout(`${baseUrl}${endpoint}`, {
      headers: { 'ApiKey': settings.ombiApiKey },
    });
    const results = await resp.json();
    if (!Array.isArray(results) || results.length === 0) return {};

    let match = null;

    if (info.imdbId) {
      match = results.find((r) => r.imdbId === info.imdbId);
      if (!match) {
        const infoEndpoint = info.type === 'series' ? 'tv' : 'movie';
        for (const r of results) {
          const rid = r.theMovieDbId || r.id;
          if (!rid) continue;
          try {
            const infoResp = await fetchWithTimeout(
              `${baseUrl}/api/v1/Search/${infoEndpoint}/info/${rid}`,
              { headers: { 'ApiKey': settings.ombiApiKey } }
            );
            const detail = await infoResp.json();
            if (detail.imdbId === info.imdbId) {
              match = { ...r, ...detail };
              break;
            }
          } catch {}
        }
      }
    }

    if (!match) match = results.find((r) => r.title?.toLowerCase() === info.title.toLowerCase()) || results[0];

    return {
      tmdbId: match.theMovieDbId || match.id || null,
      requested: match.requested || false,
      approved: match.approved || false,
      available: isAvailable(match),
    };
  } catch {
    return {};
  }
}

async function requestDetected(info) {
  const btn = $('#detectedBtn');
  btn.disabled = true;
  btn.textContent = '...';

  const settings = await getSettings();
  if (!settings.ombiUrl || !settings.ombiApiKey) {
    showToast('Configure Ombi in Settings first.', 'error');
    btn.disabled = false;
    btn.textContent = 'Add to Ombi';
    return;
  }

  try {
    let tmdbId = info._tmdbId || null;
    if (!tmdbId) {
      const status = await checkOmbiStatus(info, settings);
      tmdbId = status.tmdbId;
      if (status.available) { btn.textContent = 'Already available'; btn.classList.add('success'); return; }
      if (status.requested && info.type !== 'series') { btn.textContent = 'Already requested'; btn.classList.add('success'); return; }
    }
    if (!tmdbId) {
      showToast(`"${info.title}" not found on TMDB.`, 'error');
      btn.disabled = false;
      btn.textContent = 'Add to Ombi';
      return;
    }

    if (info.type === 'series') {
      await openSeasonPicker(info, tmdbId, settings, btn);
    } else {
      await submitMovieRequest(tmdbId, info.title, settings, btn);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Add to Ombi';
  }
}
