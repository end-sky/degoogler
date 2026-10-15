(() => {
  'use strict';

  const DEFAULT_FILES = [
    'devices_Graphene.html',
    'devices_CalyxOS.html',
    'devices_eOS.html',
    'devices_lineageOS.html'
  ];

  const OS_INFO = {
    lineage: {
      name: 'LineageOS', short: 'L', subtitle: 'Android distribution',
      root: 'https://wiki.lineageos.org', docs: 'https://wiki.lineageos.org/devices/',
      notes: 'Use the device-specific wiki and verify the exact model variant before flashing.'
    },
    graphene: {
      name: 'GrapheneOS', short: 'G', subtitle: 'Security-focused Android OS',
      root: 'https://grapheneos.org', docs: 'https://grapheneos.org/install/',
      notes: 'GrapheneOS support is limited to the models listed by the project. Check carrier and bootloader-unlock restrictions before installing.'
    },
    calyx: {
      name: 'CalyxOS', short: 'C', subtitle: 'Privacy-focused Android OS',
      root: 'https://calyxos.org', docs: 'https://calyxos.org/install/',
      notes: 'Check the current installation notices and the model-specific instructions before flashing or relocking the bootloader.'
    },
    eos: {
      name: '/e/OS', short: 'e', subtitle: 'De-Googled Android distribution',
      root: 'https://e.foundation', docs: 'https://doc.e.foundation/devices/',
      notes: 'Community builds are best-effort and can have significant bugs; the build type is shown where available.'
    }
  };

  const root = document.documentElement;
  const themeButton = document.getElementById('theme-toggle');
  const form = document.getElementById('device-search');
  const queryInput = document.getElementById('device-query');
  const statusEl = document.getElementById('data-status');
  const resultsEl = document.getElementById('results');
  const emptyEl = document.getElementById('empty-state');

  let records = [];
  let sourceFiles = [];
  let loadProblem = '';

  // Theme preference is local to this browser. Searches never leave the page.
  try {
    const saved = localStorage.getItem('foss-device-finder-theme');
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  } catch (_) { /* localStorage may be disabled; the default theme still works. */ }
  updateThemeButton();
  themeButton.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('foss-device-finder-theme', root.dataset.theme); } catch (_) {}
    updateThemeButton();
  });

  function updateThemeButton() {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    themeButton.setAttribute('aria-label', `Switch to ${next} theme`);
    themeButton.title = `Switch to ${next} theme`;
  }

  const cleanText = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const normalize = (value) => cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const unique = (values) => [...new Set(values.filter(Boolean))];

  function safeUrl(value, base) {
    try {
      const url = new URL(value, base);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch (_) {}
    return '';
  }

  async function fetchText(path) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${path}${separator}v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.text();
  }

  async function discoverSourceFiles() {
    // A local static server such as Python's http.server exposes a directory listing.
    // Reading it first means newly added .html files are found automatically.
    try {
      const listing = await fetchText('static/');
      const listingDoc = new DOMParser().parseFromString(listing, 'text/html');
      const fromListing = unique([...listingDoc.querySelectorAll('a[href]')].map((a) => {
        try {
          const url = new URL(a.getAttribute('href'), new URL('static/', location.href));
          if (url.origin !== location.origin || !url.pathname.startsWith(new URL('static/', location.href).pathname)) return '';
          const remainder = url.pathname.slice(new URL('static/', location.href).pathname.length);
          if (!remainder || remainder.includes('/') || !remainder.toLowerCase().endsWith('.html')) return '';
          return decodeURIComponent(remainder);
        } catch (_) { return ''; }
      }));
      if (fromListing.length) return fromListing;
    } catch (_) { /* A production static host may not expose directory listings. */ }

    try {
      const manifest = JSON.parse(await fetchText('static/sources.json'));
      if (Array.isArray(manifest.files)) {
        const safeFiles = unique(manifest.files.filter((name) => typeof name === 'string' && /^[a-zA-Z0-9._-]+\.html$/i.test(name)));
        if (safeFiles.length) return safeFiles;
      }
    } catch (_) { /* Fall back to the included source filenames. */ }

    return DEFAULT_FILES;
  }

  function text(node) { return node ? cleanText(node.textContent) : ''; }

  function addRecord(osKey, base) {
    const os = OS_INFO[osKey];
    const model = cleanText(base.model);
    if (!os || !model) return null;
    const record = {
      id: `${osKey}:${normalize(model)}:${normalize(base.codename || '')}`,
      osKey,
      osName: os.name,
      osShort: os.short,
      osSubtitle: os.subtitle,
      model,
      brand: cleanText(base.brand),
      codename: cleanText(base.codename),
      detailUrl: safeUrl(base.detailUrl, base.urlBase || os.root) || os.docs,
      installUrl: safeUrl(base.installUrl, os.root) || os.docs,
      supported: base.supported !== false,
      supportLabel: cleanText(base.supportLabel || 'Listed in supplied device data'),
      fields: base.fields || [],
      note: cleanText(base.note || ''),
      sourceFile: base.sourceFile || '',
      searchText: ''
    };
    record.searchText = normalize([record.brand, record.model, record.codename, record.osName, ...record.fields].join(' '));
    return record;
  }

  function parseLineage(doc, filename) {
    const output = [];
    const vendorHeadings = [...doc.querySelectorAll('h2[data-vendor]')];
    for (const item of doc.querySelectorAll('.devices .item[data-codename]')) {
      // Discontinued builds are intentionally not treated as current support.
      if (item.classList.contains('discontinued')) continue;
      const codename = cleanText(item.dataset.codename);
      const vendor = cleanText(item.closest('.devices')?.dataset.vendor);
      const heading = vendorHeadings.find((h) => h.dataset.vendor === vendor);
      const nameNode = item.querySelector('.name');
      let model = text(nameNode).replace(/\s*codename\s*:\s*.*$/i, '').trim();
      if (!model) model = text(item.querySelector('a[href]')) || codename;
      const dataUrl = item.dataset.url || `/devices/${encodeURIComponent(codename)}/`;
      const url = safeUrl(dataUrl, OS_INFO.lineage.root);
      const variant = cleanText(item.dataset.variant);
      output.push(addRecord('lineage', {
        model, brand: text(heading) || vendor, codename, detailUrl: url,
        installUrl: url || OS_INFO.lineage.docs,
        supportLabel: 'Current device list',
        fields: [variant ? `Variant ${variant}` : '', 'LineageOS device wiki'],
        note: 'The device-specific wiki is the source of truth for supported variants and installation steps.',
        sourceFile: filename
      }));
    }
    return output.filter(Boolean);
  }

  function parseGraphene(doc, filename) {
    const output = [];
    for (const section of doc.querySelectorAll('#devices section')) {
      const heading = section.querySelector('h3');
      const model = text(heading);
      if (!model) continue;
      const stableRow = [...section.querySelectorAll('tr')].find((tr) => /^stable$/i.test(text(tr.querySelector('th,td'))));
      const cells = stableRow ? [...stableRow.querySelectorAll('th,td')] : [];
      const version = text(cells[1]);
      const channelNames = unique([...section.querySelectorAll('tr')].slice(1).map((tr) => text(tr.querySelector('th,td'))).filter(Boolean));
      const codename = section.id || '';
      const fields = [];
      if (version) fields.push(`Stable release ${version}`);
      if (channelNames.length) fields.push(`Channels ${channelNames.join(' ')}`);
      output.push(addRecord('graphene', {
        model, codename, detailUrl: `https://grapheneos.org/releases#${encodeURIComponent(codename)}`,
        installUrl: 'https://grapheneos.org/install/',
        supportLabel: 'Official release list',
        fields,
        note: 'Follow the official GrapheneOS install guide and confirm carrier and bootloader requirements for your exact device.',
        sourceFile: filename
      }));
    }
    return output.filter(Boolean);
  }

  function precedingHeading(table, headings) {
    let last = null;
    for (const heading of headings) {
      if (heading.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) last = heading;
    }
    return last;
  }

  function parseCalyx(doc, filename) {
    const output = [];
    const headings = [...doc.querySelectorAll('h4')];
    for (const table of doc.querySelectorAll('table')) {
      const heading = precedingHeading(table, headings);
      const category = text(heading) || 'Supported devices';
      const isRetired = /no longer supported|discontinued|retired/i.test(category);
      for (const row of table.querySelectorAll('tbody tr, tr')) {
        const cells = [...row.querySelectorAll('th,td')];
        if (cells.length < 2 || /device\(s\)/i.test(text(cells[0]))) continue;
        const model = text(cells[0]);
        if (!model) continue;
        const osUpgrades = text(cells[1]);
        const securityUpdates = text(cells[2]);
        output.push(addRecord('calyx', {
          model, supported: !isRetired,
          supportLabel: isRetired ? 'No longer supported by CalyxOS' : category,
          detailUrl: 'https://calyxos.org/install/',
          installUrl: 'https://calyxos.org/install/',
          fields: [osUpgrades ? `OS upgrades ${osUpgrades}` : '', securityUpdates ? `Security updates ${securityUpdates}` : '', `Category ${category}`],
          note: isRetired ? 'This model appears in the supplied HTML under “No longer supported”; it is not counted as currently supported.' : 'The supplied support table lists the OS-upgrade and security-update timelines. Check the current install notices before proceeding.',
          sourceFile: filename
        }));
      }
    }
    return output.filter(Boolean);
  }

  function parseEOS(doc, filename) {
    const output = [];
    for (const row of doc.querySelectorAll('table tbody tr')) {
      const cells = [...row.querySelectorAll(':scope > td')];
      if (cells.length < 2) continue;
      const link = cells[1].querySelector('a[href]');
      const model = text(link) || text(cells[1]).replace(/\bno official unlock\b/i, '').trim();
      if (!model) continue;
      const brand = text(cells[0]);
      const codename = text(cells[1].querySelector('.name-meta .chip')) || text(cells[1].querySelector('.chip')) || '';
      const aosp = row.dataset.aosp ? `Android base ${row.dataset.aosp}` : '';
      const releaseYear = text(cells.find((cell) => cell.classList.contains('release'))) || '';
      const build = text(cells[2]?.querySelector('[class*="badge-scope__v"]'));
      const badges = [...cells[2]?.querySelectorAll('.badge-scope') || []];
      const buildLabel = badges.find((badge) => /\bbuild\b/i.test(text(badge.querySelector('.badge-scope__k'))));
      const buildType = text(buildLabel?.querySelector('.badge-scope__v')) || build;
      const compatibilityBadges = [...cells[3]?.querySelectorAll('.badge-scope') || []];
      const bootLabel = compatibilityBadges.find((badge) => /bootloader/i.test(text(badge.querySelector('.badge-scope__k'))));
      const bootloader = text(bootLabel?.querySelector('.badge-scope__v'));
      const officialUrl = safeUrl(link?.getAttribute('href') || OS_INFO.eos.docs, OS_INFO.eos.root);
      const legacy = row.dataset.legacy !== undefined && row.dataset.legacy !== '' && row.dataset.legacy !== 'false';
      output.push(addRecord('eos', {
        model, brand, codename, supported: !legacy,
        supportLabel: legacy ? 'Legacy entry in source list' : (buildType ? `${buildType} build` : 'Listed device'),
        detailUrl: officialUrl || OS_INFO.eos.docs,
        installUrl: officialUrl || OS_INFO.eos.docs,
        fields: [aosp, releaseYear ? `Release year ${releaseYear}` : '', buildType ? `Build ${buildType}` : '', bootloader ? `Bootloader ${bootloader}` : '', row.dataset['device-type'] || ''],
        note: /community/i.test(buildType) ? 'The source marks this as a community build. /e/OS describes community builds as best-effort and warns they may contain significant bugs.' : 'Open the device documentation to confirm its supported build and installation method.',
        sourceFile: filename
      }));
    }
    return output.filter(Boolean);
  }

  // Fallback for future source pages. It understands the Lineage-style card markup
  // and generic HTML tables with linked device names without executing their scripts.
  function parseGeneric(doc, filename) {
    const title = text(doc.querySelector('title')) || filename.replace(/\.html$/i, '');
    const key = `generic-${normalize(title).replace(/\s/g, '-')}`;
    const short = title.slice(0, 1).toUpperCase() || '?';
    const genericOs = {
      name: title, short, subtitle: 'Device support snapshot', root: safeUrl(doc.querySelector('link[rel="canonical"]')?.href || '', location.href),
      docs: safeUrl(doc.querySelector('link[rel="canonical"]')?.href || '', location.href) || location.href
    };
    OS_INFO[key] = genericOs;
    const output = [];
    const cardItems = [...doc.querySelectorAll('.devices .item[data-codename]')].filter((item) => !item.classList.contains('discontinued'));
    if (cardItems.length) {
      const vendors = [...doc.querySelectorAll('h2[data-vendor]')];
      for (const item of cardItems) {
        const codename = cleanText(item.dataset.codename);
        const vendor = cleanText(item.closest('.devices')?.dataset.vendor);
        const model = text(item.querySelector('.name')).replace(/\s*codename\s*:\s*.*$/i, '').trim() || codename;
        const h = vendors.find((heading) => heading.dataset.vendor === vendor);
        output.push(addRecord(key, { model, brand: text(h) || vendor, codename,
          detailUrl: safeUrl(item.dataset.url || '', genericOs.root || location.href), installUrl: genericOs.docs,
          supportLabel: 'Listed in local source', sourceFile: filename, fields: [] }));
      }
      return output.filter(Boolean);
    }
    for (const row of doc.querySelectorAll('table tbody tr')) {
      const cells = [...row.querySelectorAll(':scope > td')];
      const link = row.querySelector('a[href]');
      if (cells.length < 2 || !link) continue;
      const model = text(link);
      if (!model || /^(read more|download|install)$/i.test(model)) continue;
      const urlBase = genericOs.root || location.href;
      output.push(addRecord(key, {
        model, brand: text(cells[0]), codename: '',
        detailUrl: safeUrl(link.getAttribute('href'), urlBase), installUrl: safeUrl(link.getAttribute('href'), urlBase) || genericOs.docs,
        supportLabel: 'Found in supplied HTML table', sourceFile: filename,
        fields: cells.slice(2).map(text).filter(Boolean)
      }));
    }
    return output.filter(Boolean);
  }

  function parseSource(filename, html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const lower = filename.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (lower.includes('lineage')) return parseLineage(doc, filename);
    if (lower.includes('graphene')) return parseGraphene(doc, filename);
    if (lower.includes('calyx')) return parseCalyx(doc, filename);
    if (lower.includes('eos')) return parseEOS(doc, filename);
    return parseGeneric(doc, filename);
  }

  function setStatus(message, isError = false) {
    statusEl.classList.toggle('is-error', isError);
    statusEl.innerHTML = `<span class="loading-dot"></span>${escapeHtml(message)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  async function loadData() {
    setStatus('Reading local HTML snapshots…');
    try {
      sourceFiles = await discoverSourceFiles();
      const loaded = await Promise.all(sourceFiles.map(async (filename) => {
        try {
          const html = await fetchText(`static/${encodeURIComponent(filename)}`);
          return { filename, records: parseSource(filename, html), error: '' };
        } catch (error) {
          return { filename, records: [], error: error?.message || 'Could not read this file' };
        }
      }));
      records = loaded.flatMap((item) => item.records);
      const failed = loaded.filter((item) => item.error);
      loadProblem = failed.length ? failed.map((item) => item.filename).join(', ') : '';
      if (!records.length) {
        setStatus('No device entries loaded — open this site through a local web server.', true);
        emptyEl.innerHTML = `<div class="empty-icon" aria-hidden="true">!</div><h2>Could not read the source files.</h2><p>This page uses JavaScript fetch, which usually does not work when opened directly as <code>file://</code>. From the project folder run <code>python3 -m http.server 8000</code>, then visit <code>http://localhost:8000</code>.</p>`;
        return;
      }
      const osCount = unique(records.map((record) => record.osName)).length;
      setStatus(`${records.length.toLocaleString()} device entries · ${osCount} OS projects · ${sourceFiles.length - failed.length}/${sourceFiles.length} files read`);
      if (failed.length) {
        loadProblem = `Some snapshots could not be read: ${loadProblem}`;
        console.warn(loadProblem);
      }
    } catch (error) {
      console.error(error);
      setStatus('Could not load the local device lists.', true);
    }
  }

  function matches(query) {
    const q = normalize(query);
    if (q.length < 2) return [];
    const ranked = records.map((record) => {
      const model = normalize(record.model);
      const brandModel = normalize(`${record.brand} ${record.model}`);
      const codename = normalize(record.codename);
      let score = 0;
      if (model === q || brandModel === q || codename === q) score = 100;
      else if (model.startsWith(q) || brandModel.startsWith(q) || codename.startsWith(q)) score = 70;
      else if (` ${record.searchText} `.includes(` ${q} `)) score = 60;
      else if (record.searchText.includes(q)) score = 40;
      return { record, score };
    }).filter((item) => item.score > 0);
    ranked.sort((a, b) => b.score - a.score || a.record.osName.localeCompare(b.record.osName) || a.record.model.localeCompare(b.record.model));
    // Collapse repeated source entries from a single OS, while keeping different OS matches.
    const seen = new Set();
    return ranked.map((item) => item.record).filter((record) => {
      const key = `${record.osKey}|${normalize(record.brand)}|${normalize(record.model)}|${normalize(record.codename)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function factsFor(record) {
    const facts = [];
    if (record.brand) facts.push(['Manufacturer', record.brand]);
    if (record.codename) facts.push(['Codename', record.codename]);
    if (record.fields.length) {
      const knownLabels = ['Security updates', 'OS upgrades', 'Release year', 'Android base', 'Stable release', 'Bootloader', 'Channels', 'Variant', 'Build', 'Category'];
      for (const field of record.fields) {
        if (!field) continue;
        const labelMatch = knownLabels.find((label) => field.toLowerCase().startsWith(`${label.toLowerCase()} `));
        const label = labelMatch || 'Details';
        const value = labelMatch ? field.slice(labelMatch.length).trim() : field;
        if (label && value && !facts.some((f) => f[0] === label && f[1] === value)) facts.push([label, value]);
      }
    }
    return facts.slice(0, 4);
  }

  function cardMarkup(record, historical = false) {
    const os = OS_INFO[record.osKey] || { name: record.osName, short: record.osShort, subtitle: record.osSubtitle };
    const facts = factsFor(record);
    const docUrl = safeUrl(record.installUrl || record.detailUrl, location.href) || '#';
    const docLabel = record.osKey === 'lineage' || record.osKey === 'eos' ? 'Open device documentation' : 'Open official install guide';
    const label = historical ? 'Past listing' : record.supportLabel;
    return `<article class="device-card">
      <div class="device-card-top"><div class="os-identity"><span class="os-mark" aria-hidden="true">${escapeHtml(os.short || '?')}</span><div><h3 class="os-title">${escapeHtml(os.name || record.osName)}</h3><p class="os-subtitle">${escapeHtml(os.subtitle || 'Device support snapshot')}</p></div></div><span class="support-pill ${historical ? 'support-pill--past' : ''}">${historical ? 'Not current' : '✓ Listed'}</span></div>
      <h4 class="card-model">${escapeHtml(record.model)}</h4>
      ${record.brand ? `<p class="card-brand">${escapeHtml(record.brand)}${record.codename ? ` · ${escapeHtml(record.codename)}` : ''}</p>` : ''}
      <dl class="device-facts">${facts.map(([key, value]) => `<div class="fact"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
      <p class="card-note">${escapeHtml(record.note || label)}${record.supportLabel && !historical ? ` <span class="support-detail">Source: ${escapeHtml(record.supportLabel)}.</span>` : ''}</p>
      <a class="doc-link" href="${escapeHtml(docUrl)}" target="_blank" rel="noopener noreferrer"><span>${docLabel}</span><span aria-hidden="true">↗</span></a>
    </article>`;
  }

  function renderResults(query) {
    const found = matches(query);
    const current = found.filter((record) => record.supported);
    const historical = found.filter((record) => !record.supported);
    emptyEl.hidden = true;
    resultsEl.hidden = false;

    const allLimited = current.slice(0, 24);
    const histLimited = historical.slice(0, 12);
    const currentOs = unique(current.map((record) => record.osName));
    let html = `<div class="result-heading"><div><h2>Results for “${escapeHtml(query)}”</h2><p>${found.length ? 'Matches in the local HTML snapshots.' : 'No device name or codename matched the supplied snapshots.'}</p></div><span class="result-count">${found.length} ${found.length === 1 ? 'match' : 'matches'}</span></div>`;

    if (current.length) {
      const osSentence = currentOs.join(', ');
      html += `<div class="status-banner status-banner--success"><span class="status-icon" aria-hidden="true">✓</span><div><h3>Supported! Your device is supported by ${escapeHtml(osSentence)}.</h3><p>Open the official documentation on the matching card below for installation instructions and device-specific cautions.</p></div></div>`;
    } else {
      html += `<div class="status-banner status-banner--unsupported"><span class="status-icon" aria-hidden="true">!</span><div><h3>Not supported.</h3><p>Maybe there’s unofficial firmware. <a href="risks.html">Learn the risks ↗</a> before considering a community build or unsupported port.</p></div></div>`;
    }

    if (current.length) html += `<div class="result-grid">${allLimited.map((record) => cardMarkup(record, false)).join('')}</div>`;
    if (current.length > allLimited.length) html += `<p class="show-more-note">Showing the first ${allLimited.length} of ${current.length} current matches. Add a model number or codename to narrow the results.</p>`;
    if (historical.length) {
      html += `<section class="history-section"><h3>Found in older or unsupported entries</h3><p>These names appear in the supplied HTML but are marked as legacy or no longer supported. They are not counted as current support.</p><div class="result-grid">${histLimited.map((record) => cardMarkup(record, true)).join('')}</div></section>`;
      if (historical.length > histLimited.length) html += `<p class="show-more-note">Showing ${histLimited.length} of ${historical.length} older entries.</p>`;
    }
    if (!found.length) {
      html += `<p class="show-more-note">This checker only searches the local snapshots you supplied; a community/unofficial port may exist elsewhere. No match does not prove that recovery or other custom firmware is impossible.</p>`;
    }
    if (loadProblem) html += `<p class="show-more-note">Some files did not load: ${escapeHtml(loadProblem)}.</p>`;
    resultsEl.innerHTML = html;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = cleanText(queryInput.value);
    if (normalize(query).length < 2) {
      queryInput.focus();
      return;
    }
    renderResults(query);
  });

  document.querySelectorAll('[data-query]').forEach((button) => {
    button.addEventListener('click', () => {
      queryInput.value = button.dataset.query || '';
      renderResults(queryInput.value);
      queryInput.focus();
    });
  });

  loadData();
})();
