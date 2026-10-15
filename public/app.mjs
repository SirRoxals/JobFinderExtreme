import { filterJobs, parseKeywords, matchedKeywords, safeUrl, experienceRequirementFor, deduplicateJobs } from '/jobs.mjs';
import { buildBoardSearches } from '/boards.mjs';

const $ = (selector) => document.querySelector(selector);
const form = $('#filter-form');
const DEFAULTS = { role: '', roleFocus: '', keywords: '', keywordMode: 'all', experienceYears: '', includeUnknownExperience: true, location: '', minSalary: '', includeUnknownSalary: true, salaryOnly: false, days: '30', dateFrom: '', dateTo: '', depth: 'standard', sort: 'newest' };
const LABELS = { unknown: 'Not specified', remote: 'Fully remote', hybrid: 'Hybrid', onsite: 'On-site' };
const PAGE_SIZE = 15;
const STORAGE = { filters: 'jfe.filters.v2', saved: 'jfe.saved.v1' };
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const href = (url) => esc(safeUrl(url));
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const currentPreferences = read(STORAGE.filters, null);
const storedFilters = currentPreferences || read('jfe.filters.v1', {});
let filters = { ...DEFAULTS };
for (const key of Object.keys(DEFAULTS)) {
  const value = storedFilters?.[key];
  if (typeof value === typeof DEFAULTS[key]) filters[key] = value;
}
if (!currentPreferences) {
  filters.includeUnknownExperience = true;
  if (filters.days === '7') filters.days = '30';
}
if (!Number.isFinite(Number(filters.experienceYears)) || Number(filters.experienceYears) < 0 || Number(filters.experienceYears) > 60) filters.experienceYears = DEFAULTS.experienceYears;
const storedSaved = read(STORAGE.saved, []);
let saved = (Array.isArray(storedSaved) ? storedSaved : []).filter((job) => job && ['id', 'title', 'company', 'location', 'description', 'applyUrl', 'sourceId', 'sourceName'].every((key) => typeof job[key] === 'string') && safeUrl(job.applyUrl)).slice(0, 200);
let jobs = [], sources = [], visible = [], page = 1, view = 'discover', loading = false, loadFailed = false, checkedAt = null, detailJob = null, toastTimer;
let searchInfo = null, requestController, requestNumber = 0, autoSearchTimer, lastSearchSignature = '', progressState = { completed: 0, total: 1 };

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}

function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { toast('Browser storage is full or unavailable. Changes will last for this session.'); return false; }
}

function writeForm() {
  for (const key of Object.keys(DEFAULTS)) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (key === 'keywordMode') { for (const radio of field) radio.checked = radio.value === filters[key]; }
    else if (field.type === 'checkbox') field.checked = filters[key];
    else field.value = filters[key];
  }
  $('#sort').value = filters.sort;
  syncDateInputs();
}

function syncDateInputs() {
  const custom = $('#days').value === 'custom';
  $('#custom-dates').hidden = !custom;
  for (const id of ['dateFrom', 'dateTo']) $(`#${id}`).disabled = !custom;
  const invalid = custom && $('#dateFrom').value && $('#dateTo').value && $('#dateFrom').value > $('#dateTo').value;
  $('#dateTo').setCustomValidity(invalid ? 'End date must be on or after the start date.' : '');
  $('#date-error').hidden = !invalid;
  $('#dateFrom').max = custom ? $('#dateTo').value : '';
  $('#dateTo').min = custom ? $('#dateFrom').value : '';
}

function readForm() {
  const values = new FormData(form);
  for (const key of Object.keys(DEFAULTS)) {
    if (key === 'sort') continue;
    filters[key] = typeof DEFAULTS[key] === 'boolean' ? values.has(key) : String(values.get(key) || '');
  }
  filters.sort = $('#sort').value;
  persist(STORAGE.filters, filters);
  page = 1;
  render();
  queueOnlineSearch();
}

function onlineParams() {
  return new URLSearchParams(Object.fromEntries(['role', 'roleFocus', 'keywords', 'days', 'dateFrom', 'dateTo', 'depth'].map(key => [key, filters[key]])));
}
function queueOnlineSearch() {
  clearTimeout(autoSearchTimer);
  if (onlineParams().toString() !== lastSearchSignature) autoSearchTimer = setTimeout(loadJobs, 900);
}

function salaryLabel(salary) {
  if (!salary) return 'Salary not disclosed';
  if (salary.text) return salary.text;
  if (salary.min == null && salary.max == null) return 'Salary not disclosed';
  const money = (amount) => {
    if (amount == null) return '';
    if (!salary.currency) return Number(amount).toLocaleString();
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: salary.currency, maximumFractionDigits: salary.period === 'hour' ? 2 : 0 }).format(amount); }
    catch { return `${salary.currency} ${Number(amount).toLocaleString()}`; }
  };
  const range = salary.min && salary.max && salary.min !== salary.max ? `${money(salary.min)} – ${money(salary.max)}` : salary.min ? `${money(salary.min)}${salary.max ? '' : '+'}` : `Up to ${money(salary.max)}`;
  return `${range}${salary.period ? ` / ${salary.period === 'year' ? 'yr' : salary.period === 'hour' ? 'hr' : 'mo'}` : ' (period unspecified)'}`;
}

function ageLabel(date) {
  if (!date) return 'Date not supplied';
  const hours = (Date.now() - Date.parse(date)) / 3600000;
  if (hours < 1) return 'Just posted';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const dateLabel = (date) => date ? new Date(date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not supplied';
const isSaved = (id) => saved.some((job) => job.id === id);
function experienceLabel(job) {
  const requirement = experienceRequirementFor(job);
  return requirement.minYears === null ? 'Years not stated · review fit' : requirement.exclusive ? `More than ${requirement.minYears} years required` : `${requirement.minYears}+ years required`;
}
const savedButton = (job) => `<button class="save-button${isSaved(job.id) ? ' saved' : ''}" data-save="${esc(job.id)}" aria-label="${isSaved(job.id) ? 'Unsave' : 'Save'} ${esc(job.title)}" aria-pressed="${isSaved(job.id)}" title="${isSaved(job.id) ? 'Remove from saved jobs' : 'Save job'}">${icon('bookmark')}</button>`;

function card(job) {
  const matched = matchedKeywords(job, parseKeywords(filters.keywords));
  const initials = job.company.split(/\s+/).slice(0, 2).map((word) => [...word][0]).join('').toUpperCase();
  const color = [...job.company].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  const fresh = job.postedAt && Date.now() - Date.parse(job.postedAt) < 86400000;
  const location = job.location.length > 65 ? `${job.location.slice(0, 62)}…` : job.location;
  return `<article class="job-card">
    <div class="card-top"><div class="company-avatar avatar-${color}" aria-hidden="true">${esc(initials)}</div><div class="card-identity"><p class="card-company">${esc(job.company)}<span class="source-tag">${esc(job.sourceName)}</span></p><h3 class="job-heading"><button class="job-title" data-detail="${esc(job.id)}">${esc(job.title)}</button></h3></div>${savedButton(job)}</div>
    <div class="card-time" title="${esc(job.postedDateLabel || 'Posted')}: ${esc(dateLabel(job.postedAt))}">${icon('clock')}${esc(ageLabel(job.postedAt))}${job.postedDateLabel && job.postedDateLabel !== 'Posted' ? ` · ${esc(job.postedDateLabel.toLowerCase())}` : ''}${fresh ? '<span class="fresh-tag">NEW</span>' : ''}</div>
    <div class="card-meta"><span title="${esc(job.location)}">${icon('pin')}${esc(location)}</span><span>${icon('remote')}Fully remote</span><span class="salary-meta"><span class="meta-icon" aria-hidden="true">$</span>${esc(salaryLabel(job.salary))}</span></div>
    <p class="card-description">${esc(job.description.slice(0, 380) || 'Open the listing for the full job description.')}</p>
    <div class="card-tags card-tag-row"><span class="tag experience-tag" title="${esc(experienceRequirementFor(job).evidence || 'No explicit years requirement found. Review your fit.')}" >${esc(experienceLabel(job))}</span>${job.employmentType ? `<span class="tag">${esc(job.employmentType)}</span>` : ''}${matched.map((word) => `<span class="tag matched" title="Found in the title or full description">✓ ${esc(word)}</span>`).join('')}</div><div class="card-bottom"><span class="card-source">via ${esc(job.sourceName)}</span><a class="apply-link" href="${href(job.applyUrl)}" target="_blank" rel="noopener noreferrer">View & apply ${icon('arrow')}</a></div>
  </article>`;
}

function chips() {
  const items = [];
  if (filters.role) items.push(['role', filters.role]);
  if (filters.roleFocus) items.push(['roleFocus', $('#roleFocus').selectedOptions[0]?.textContent || filters.roleFocus]);
  if (filters.location) items.push(['location', filters.location]);
  if (filters.days) items.push(['days', filters.days === 'custom' ? `${filters.dateFrom || 'Any start date'} → ${filters.dateTo || 'Any end date'}` : filters.days === '1' ? 'Past 24 hours' : `Past ${filters.days} days`]);
  if (filters.experienceYears !== '') items.push(['experienceYears', `${filters.experienceYears} years experience`]);
  if (filters.minSalary) items.push(['minSalary', `$${Number(filters.minSalary).toLocaleString()}+ USD / yr`]);
  if (filters.salaryOnly) items.push(['salaryOnly', 'Annual USD pay disclosed']);
  const words = parseKeywords(filters.keywords);
  $('#active-filters').innerHTML = `<span class="filter-chip">USA only</span><span class="filter-chip">Fully remote</span>` + items.map(([key, label]) => `<span class="filter-chip">${esc(label)}<button data-remove="${key}" aria-label="Remove ${esc(label)} filter">×</button></span>`).join('') + words.map((word, index) => `<span class="filter-chip">${filters.keywordMode === 'all' ? '✓' : '◇'} ${esc(word)}<button data-keyword="${index}" aria-label="Remove keyword ${esc(word)}">×</button></span>`).join('');
}

function render() {
  chips();
  renderBoards();
  const all = view === 'saved' ? saved : jobs;
  visible = filterJobs(all, filters);
  $('#saved-count').textContent = saved.length;
  $('#result-count').textContent = visible.length;
  $('#stat-total').textContent = loading && !jobs.length ? '—' : visible.length;
  $('#stat-today').textContent = loading && !jobs.length ? '—' : visible.filter((job) => job.postedAt && Date.now() - Date.parse(job.postedAt) < 86400000).length;
  $('#stat-salary').textContent = loading && !jobs.length ? '—' : visible.filter((job) => job.salary?.text || job.salary?.min || job.salary?.max).length;
  $('#stat-sources').textContent = new Set(visible.map(job => job.company.toLowerCase())).size || (loading ? '—' : '0');
  $('#discovery-summary').textContent = jobs.length ? `${jobs.length.toLocaleString()} US remote software roles in your search pool · ${new Set(jobs.map(job => job.company.toLowerCase())).size.toLocaleString()} companies${searchInfo?.origins?.length ? ` · ${searchInfo.origins.length} underlying job sources` : ''}${loading ? ' · Still searching' : ''}` : 'Searching across company career sites and job boards. No company list needed.';
  $('#experience-summary').hidden = filters.experienceYears === '';
  if (filters.experienceYears !== '') {
    const unknown = visible.filter(job => experienceRequirementFor(job).minYears === null).length;
    $('#experience-summary').textContent = `${visible.length - unknown} have stated experience requirements you meet · ${unknown} have unstated years to review.${Number(filters.experienceYears) < 5 ? ' Senior and higher-level titles are excluded.' : ''}`;
  }
  $('#deeper-search').hidden = !searchInfo?.limited || loading;
  $('#deeper-button').hidden = filters.depth === 'deep';
  $('#deeper-message').textContent = filters.depth === 'deep' ? 'A source reached its page or time limit. Use a narrower role or posting window to search that slice further. See coverage for each source’s limit.' : 'The broad catalogue already reads up to 10,000 candidates. Deep search reads further into the supplementary indexes and LinkedIn.';
  $('#results-title').textContent = view === 'saved' ? 'Saved for your next move' : 'Your next opportunity';
  for (const button of document.querySelectorAll('[data-view]')) button.classList.toggle('active', button.dataset.view === view);
  $('#discover-tab').classList.toggle('active', view === 'discover');
  $('#discover-tab').setAttribute('aria-pressed', view === 'discover');
  $('#saved-tab').classList.toggle('active', view === 'saved');
  $('#saved-tab').setAttribute('aria-pressed', view === 'saved');
  $('#results-subtitle').textContent = view === 'saved' ? `${saved.length} saved · ${visible.length} match your filters · Saved openings may have closed.`
    : loading ? 'Live results appear as pages arrive. You can browse and filter now.' : checkedAt ? `${searchInfo?.pages || 0} pages searched · ${sources.filter(source => !source.error).length}/${sources.length} indexes completed · Checked ${new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Your local search workspace';
  $('#sort-caption').textContent = visible.length ? `${Math.min((page - 1) * PAGE_SIZE + 1, visible.length)}–${Math.min(page * PAGE_SIZE, visible.length)} of ${visible.length} opportunities` : 'A fresh start for your next chapter.';
  $('#export-button').disabled = !visible.length;
  $('#jobs-list').setAttribute('aria-busy', loading);
  if (loading && !visible.length && view === 'discover') {
    $('#pagination').hidden = true;
    $('#jobs-list').innerHTML = '<div class="loading-state"><span class="loader"></span><h3>Searching the wider job market</h3><p>Reading full postings across career sites and job boards. The first matches will appear here while the search continues.</p></div>';
    return;
  }
  if (!visible.length) {
    const failed = loadFailed || (sources.length > 0 && sources.every((source) => source.error) && !jobs.length);
    $('#jobs-list').innerHTML = `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">${failed ? '↻' : view === 'saved' ? '▢' : '⌕'}</span><h3>${failed ? 'The feeds couldn’t be reached' : view === 'saved' && !saved.length ? 'A good opportunity is worth saving.' : 'Your next role is still out there.'}</h3><p>${failed ? 'Check your internet connection, then try again. Source details show which feeds are unavailable.' : view === 'saved' && !saved.length ? 'Use the save button on a job to keep it here, in this browser.' : 'No US remote jobs match these filters. Try fewer keywords, a wider date range, or include jobs with no stated experience years if you want to review unverified fits.'}</p><button class="button button-outline button-small" data-empty-action="${failed ? 'retry' : view === 'saved' && !saved.length ? 'discover' : 'reset'}">${failed ? 'Try again' : view === 'saved' && !saved.length ? 'Explore jobs →' : 'Reset filters →'}</button></div>`;
  } else $('#jobs-list').innerHTML = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(card).join('');
  const pages = Math.ceil(visible.length / PAGE_SIZE);
  $('#pagination').hidden = pages <= 1;
  $('#page-label').textContent = `Page ${page} of ${pages}`;
  $('#previous-button').disabled = page <= 1;
  $('#next-button').disabled = page >= pages;
}

async function loadJobs() {
  clearTimeout(autoSearchTimer);
  requestController?.abort();
  requestController = new AbortController();
  const number = ++requestNumber;
  let receivedBatch = false;
  const params = onlineParams(); lastSearchSignature = params.toString();
  loading = true; $('#refresh-button').disabled = true;
  $('#search-progress').hidden = false;
  progressState = { completed: 0, total: 1 };
  $('#progress-message').textContent = 'Searching across companies…';
  $('#progress-detail').textContent = 'Requesting software development roles in the United States';
  $('#progress-bar').value = 0; render();
  try {
    const response = await fetch(`/api/jobs?${params}`, { headers: { Accept: 'application/x-ndjson' }, signal: AbortSignal.any([requestController.signal, AbortSignal.timeout(210000)]) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let data;
    if (response.headers.get('content-type')?.includes('application/x-ndjson')) {
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      const consume = line => {
        if (!line.trim() || number !== requestNumber) return;
        const event = JSON.parse(line);
        if (event.type === 'complete') data = event.data;
        else if (event.type === 'batch' && Array.isArray(event.jobs)) {
          // Keep previous results visible until the new search has real data.
          if (!receivedBatch) { jobs = []; searchInfo = null; receivedBatch = true; }
          jobs = deduplicateJobs([...jobs, ...event.jobs]); render();
        }
        else if (event.type === 'error') throw new Error(event.error);
        else if (event.type === 'progress') {
          progressState = { ...progressState, ...event };
          $('#progress-message').textContent = event.source || 'Searching…';
          $('#progress-detail').textContent = `${progressState.completed}/${progressState.total} searches complete${event.query ? ` · ${event.query}` : ''}${event.scanned ? ` · ${event.scanned.toLocaleString()}${event.available ? ` / ${event.available.toLocaleString()}` : ''} candidates read` : event.pages ? ` · ${event.pages} pages read` : ''}${jobs.length ? ` · ${jobs.length.toLocaleString()} US remote software roles loaded` : ''}`;
          $('#progress-bar').max = progressState.total; $('#progress-bar').value = progressState.completed;
        }
      };
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) { buffer += decoder.decode(); break; }
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop(); lines.forEach(consume);
      }
      if (buffer.trim()) consume(buffer);
      if (!data) throw new Error('Search ended without a result.');
    } else data = await response.json();
    if (number !== requestNumber) return;
    jobs = data.jobs; sources = data.sources; checkedAt = data.checkedAt; searchInfo = data.search || null; loadFailed = false;
    const failures = sources.filter((source) => source.error);
    $('#feed-warning').hidden = !failures.length;
    $('#feed-warning').textContent = failures.length ? `Some searches could not finish on ${failures.map(source => source.name).join(', ')}. Available results are shown. Check search coverage for errors and limits.` : '';
  } catch {
    if (number !== requestNumber) return;
    loadFailed = true; $('#feed-warning').hidden = false;
    $('#feed-warning').textContent = 'The online search could not finish. Keep the local server running, check your connection, and retry. Previously loaded results remain visible.';
  } finally {
    if (number === requestNumber) { loading = false; $('#refresh-button').disabled = false; $('#search-progress').hidden = true; page = 1; render(); renderSources(); }
  }
}

function toggleSave(job) {
  if (isSaved(job.id)) saved = saved.filter((item) => item.id !== job.id);
  else {
    if (saved.length >= 200) { toast('Your saved list is full. Remove a job before saving another.'); return; }
    saved.unshift({ ...job, savedAt: new Date().toISOString(), description: job.description.slice(0, 60000) });
  }
  if (persist(STORAGE.saved, saved)) toast(isSaved(job.id) ? 'Saved in this browser.' : 'Removed from saved jobs.');
  page = Math.min(page, Math.max(1, Math.ceil(filterJobs(view === 'saved' ? saved : jobs, filters).length / PAGE_SIZE)));
  render();
  if (detailJob?.id === job.id && $('#detail-dialog').open) renderDetail(job);
}

function renderDetail(job) {
  detailJob = job;
  const keywords = matchedKeywords(job, parseKeywords(filters.keywords));
  const requirement = experienceRequirementFor(job);
  $('#detail-content').innerHTML = `<p class="detail-company">${esc(job.company)} · Sourced from <a href="${href(job.listingUrl || job.sourceUrl || job.applyUrl)}" target="_blank" rel="noopener noreferrer">${esc(job.sourceName)}</a></p><h2 class="detail-title">${esc(job.title)}</h2><div class="detail-meta"><span>${esc(job.location)}</span><span>Fully remote</span><span>${esc(salaryLabel(job.salary))}</span><span>${esc(experienceLabel(job))}</span></div><p class="detail-note"><strong>Experience requirement:</strong> ${esc(requirement.evidence || 'No explicit years requirement found. Review the description to check your fit.')}</p>${keywords.length ? `<div class="card-tags">${keywords.map((word) => `<span class="tag matched">✓ ${esc(word)} appears in this listing</span>`).join('')}</div>` : ''}<p class="detail-note">${esc(job.postedDateLabel || 'Posted')}: ${esc(dateLabel(job.postedAt))}${job.updatedAt ? ` · Updated: ${esc(dateLabel(job.updatedAt))}` : ''}${job.dateCaution ? `<br>${esc(job.dateCaution)}` : ''}<br>Requirements are read automatically from listing text. Confirm experience, US/state eligibility, compensation, and availability on the original listing.</p><div class="detail-actions"><a class="button button-primary" href="${href(job.applyUrl)}" target="_blank" rel="noopener noreferrer">View listing & apply ↗</a><button class="button button-outline" data-save="${esc(job.id)}">${isSaved(job.id) ? 'Remove from saved' : 'Save for later'}</button></div><div class="detail-description">${esc(job.description || 'No description supplied. Open the original listing for details.')}</div>`;
}

function renderSources() {
  $('#source-list').innerHTML = sources.length ? sources.map(source => `<div class="source-row"><div><strong>${esc(source.name)}</strong><a href="${href(source.url)}" target="_blank" rel="noopener noreferrer">Visit ↗</a><p>${esc(source.note)}</p><span class="source-status${source.error ? ' error' : ''}">${source.count.toLocaleString()} US remote software roles · ${(source.scanned || 0).toLocaleString()} candidates read${source.available != null ? ` / ${source.available.toLocaleString()} reported` : ''} · ${source.pages == null ? 'page count unavailable' : `${source.pages} pages`}${source.truncated ? ' · Source limit reached' : ''}${source.error ? ` · ${esc(source.error)}` : ''}${source.stale ? ' · Cached results may be stale' : ''}</span>${source.origins?.length ? `<details class="origin-details"><summary>${source.origins.length} underlying sources in this search</summary><p>${source.origins.map(esc).join(' · ')}</p></details>` : ''}${source.queries?.length ? `<p>Queries: ${source.queries.map(esc).join(' · ')}</p>` : ''}<p>Loaded: ${esc(dateLabel(source.fetchedAt))} · Next refresh: ${esc(dateLabel(source.nextCheckAt))}</p></div></div>`).join('') : '<p class="dialog-intro">Coverage appears after the first online search.</p>';
}

function renderBoards() {
  $('#board-links').innerHTML = buildBoardSearches(filters).map(board => `<a class="board-link" href="${href(board.url)}" target="_blank" rel="noopener noreferrer"><span class="board-logo ${board.color}" aria-hidden="true">${esc(board.short)}</span><div><strong>${esc(board.name)}</strong><small>${esc(board.note)}</small></div>${icon('arrow')}</a>`).join('');
}

function resetFilters() { filters = { ...DEFAULTS }; page = 1; writeForm(); persist(STORAGE.filters, filters); render(); renderSources(); queueOnlineSearch(); }
function switchView(next) { view = next; page = 1; render(); }

function exportCSV() {
  const rows = [['Company', 'Job title', 'Location', 'Work arrangement', 'Salary', 'Required experience', 'Experience evidence', 'Source date', 'Date type', 'Source', 'Application link'], ...visible.map((job) => [job.company, job.title, job.location, 'Fully remote', salaryLabel(job.salary), experienceLabel(job), experienceRequirementFor(job).evidence, job.postedAt || '', job.postedDateLabel || 'Posted', job.sourceName, job.applyUrl])];
  const cell = (value) => `"${String(value).replace(/^[\s]*[=+@-]/, (match) => `'${match}`).replace(/"/g, '""')}"`;
  const blob = new Blob(['\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `software-jobs-${new Date().toLocaleDateString('en-CA')}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast(`Exported ${visible.length} matching jobs.`);
}

let debounce;
const scheduleFilters = () => { syncDateInputs(); clearTimeout(debounce); debounce = setTimeout(() => { if (form.checkValidity()) readForm(); }, 200); };
form.addEventListener('input', scheduleFilters);
$('#role').addEventListener('input', scheduleFilters);
form.addEventListener('change', () => { syncDateInputs(); clearTimeout(debounce); if (form.checkValidity()) readForm(); });
form.addEventListener('submit', (event) => { event.preventDefault(); clearTimeout(debounce); readForm(); loadJobs(); if ($('#filters-dialog').open) $('#filters-dialog').close(); $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('#sort').addEventListener('change', readForm);
$('#reset-button').addEventListener('click', resetFilters);
$('#refresh-button').addEventListener('click', loadJobs);
$('#discover-tab').addEventListener('click', () => switchView('discover'));
$('#saved-tab').addEventListener('click', () => switchView('saved'));
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => switchView(button.dataset.view));
$('#export-button').addEventListener('click', exportCSV);
$('#previous-button').addEventListener('click', () => { page--; render(); $('#results').scrollIntoView({ block: 'start' }); });
$('#next-button').addEventListener('click', () => { page++; render(); $('#results').scrollIntoView({ block: 'start' }); });
const openSources = () => { renderSources(); $('#sources-dialog').showModal(); };
$('#sources-button').addEventListener('click', openSources);
$('#coverage-button').addEventListener('click', openSources);
for (const button of document.querySelectorAll('[data-open-sources]')) button.addEventListener('click', openSources);
for (const button of document.querySelectorAll('[data-open-boards]')) button.addEventListener('click', () => $('#board-section').scrollIntoView({ behavior: 'smooth' }));
$('#close-detail').addEventListener('click', () => $('#detail-dialog').close());
$('#close-sources').addEventListener('click', () => $('#sources-dialog').close());
$('#done-sources').addEventListener('click', () => $('#sources-dialog').close());
$('#active-filters').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.keyword !== undefined) filters.keywords = parseKeywords(filters.keywords).filter((_, index) => index !== Number(button.dataset.keyword)).join(', ');
  else { const key = button.dataset.remove; filters[key] = typeof DEFAULTS[key] === 'boolean' ? false : ''; }
  page = 1; writeForm(); persist(STORAGE.filters, filters); render(); renderSources(); queueOnlineSearch();
});
document.addEventListener('click', (event) => {
  const keyword = event.target.closest('[data-add-keyword]');
  if (keyword) { $('#keywords').value = [...new Set([...parseKeywords($('#keywords').value), keyword.dataset.addKeyword])].join(', '); readForm(); return; }
  const target = event.target.closest('[data-detail], [data-save], [data-empty-action]');
  if (!target) return;
  if (target.dataset.emptyAction) {
    if (target.dataset.emptyAction === 'retry') loadJobs();
    else if (target.dataset.emptyAction === 'discover') switchView('discover');
    else resetFilters();
    return;
  }
  const job = [...jobs, ...saved].find((item) => item.id === (target.dataset.detail || target.dataset.save));
  if (!job) return;
  if (target.dataset.save) toggleSave(job);
  else { renderDetail(job); $('#detail-dialog').showModal(); }
});
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });

$('#open-filters').addEventListener('click', () => { $('#filters-dialog').append($('#filter-panel')); $('#filters-dialog').showModal(); });
$('#close-filters').addEventListener('click', () => $('#filters-dialog').close());
$('#filters-dialog').addEventListener('close', () => $('#filter-home').prepend($('#filter-panel')));
matchMedia('(min-width: 851px)').addEventListener('change', (event) => { if (event.matches && $('#filters-dialog').open) $('#filters-dialog').close(); });
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#role').focus(); } });

$('#deeper-button').addEventListener('click', () => { filters.depth = 'deep'; writeForm(); persist(STORAGE.filters, filters); loadJobs(); });
$('#density').value = read('jfe.display.v1', 'comfortable') === 'compact' ? 'compact' : 'comfortable';
document.body.dataset.density = $('#density').value;
$('#density').addEventListener('change', () => { document.body.dataset.density = $('#density').value; persist('jfe.display.v1', $('#density').value); });

writeForm();
loadJobs();
