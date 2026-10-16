import { load } from 'cheerio';
import { normalize } from './sources.mjs';
import { deduplicateJobs, isSoftwareJob, isUSRemoteJob, parseKeywords, salaryData, plainText } from './jobs.mjs';

const SOURCE = { id: 'dice', name: 'Dice', url: 'https://www.dice.com', note: 'Direct public US remote searches with full posting-page verification. Original posting timestamps are used; edits never make an old job fresh. Search snippets and similar-job recommendations are not accepted as verified results.' };

// Next.js flight chunks contain JSON strings. Parse data only; never execute the
// page's scripts. Ignore "similar jobs" lists embedded beside the real search.
export function parseDiceSearch(html) {
  const $ = load(html), lists = [];
  const chunks = $('script').map((_, el) => {
    const match = $(el).text().match(/^self\.__next_f\.push\(([\s\S]*)\)\s*;?$/);
    if (!match) return '';
    try { const value = JSON.parse(match[1]); return value[0] === 1 && typeof value[1] === 'string' ? value[1] : ''; } catch { return ''; }
  }).get().join('');
  const visit = (item, depth = 0) => {
    if (!item || typeof item !== 'object' || depth > 100) return;
    if (item.jobList?.data && item.jobList?._links?.self?.href?.includes('/jobs/search?')) lists.push(item.jobList);
    for (const child of Object.values(item)) if (child && typeof child === 'object') visit(child, depth + 1);
  };
  for (const line of chunks.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    try { visit(JSON.parse(line.slice(colon + 1))); } catch { /* Non-JSON flight frames. */ }
  }
  const result = lists[0];
  if (!result) throw new Error('Dice returned an unrecognized search page.');
  return { jobs: result.data, total: result.meta?.totalResults || 0, pageCount: result.meta?.pageCount || 1,
    country: result.meta?.searchedLocation?.countryCode2 || null };
}

export function jobPostingSchemas(html) {
  const $ = load(html), result = [];
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (item['@type'] === 'JobPosting' || item['@type']?.includes?.('JobPosting')) result.push(item);
    if (item['@graph']) visit(item['@graph']);
  };
  $('script[type="application/ld+json"]').each((_, el) => { try { visit(JSON.parse($(el).text())); } catch { /* Invalid structured data proves nothing. */ } });
  return result;
}

export function normalizeSchemaPosting(schema, card = {}, source = SOURCE) {
  if (!schema?.description) return null;
  const restrictions = Array.isArray(schema.applicantLocationRequirements) ? schema.applicantLocationRequirements : [schema.applicantLocationRequirements];
  const places = Array.isArray(schema.jobLocation) ? schema.jobLocation : [schema.jobLocation];
  const location = [...new Set([...restrictions.filter(Boolean).map(value => value.name), ...places.filter(Boolean).flatMap(place => {
    const a = place.address || {}; return [a.addressLocality, a.addressRegion, typeof a.addressCountry === 'object' ? a.addressCountry.name : a.addressCountry];
  }), card.location].filter(Boolean))].join(' · ');
  const pay = schema.baseSalary, range = pay?.value || pay || {};
  const job = normalize({ id: schema.identifier?.value || card.guid || card.id || card.url }, source, {
    title: schema.title || card.title, company: schema.hiringOrganization?.name || card.companyName,
    location, workplace: schema.jobLocationType === 'TELECOMMUTE' ? 'remote' : 'unknown',
    description: schema.description, postedAt: schema.datePosted || card.postedDate, expiry: schema.validThrough,
    employmentType: schema.employmentType, applyUrl: card.url || schema.url, listingUrl: card.url || schema.url,
    salary: salaryData(range.minValue ?? (typeof pay?.value === 'number' ? pay.value : null), range.maxValue, pay?.currency, range.unitText),
  });
  return job && isUSRemoteJob(job) ? job : null;
}

export function createDiceService({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const cache = new Map(), inFlight = new Map(), details = new Map();
  let blockedUntil = 0;
  async function loadSearch(query, filters, onBatch, onProgress) {
    const days = Number(filters.days) > 0 ? Number(filters.days) : 0;
    const range = days && days <= 1 ? 'ONE' : days && days <= 3 ? 'THREE' : days && days <= 7 ? 'SEVEN' : null;
    const key = `${query}|${days}|${range}|${filters.depth}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) { onBatch?.(cached.jobs); return cached; }
    if (inFlight.has(key)) { const result = await inFlight.get(key); onBatch?.(result.jobs); return result; }
    const pending = (async () => {
      const jobs = [], seen = new Set(); let pages = 0, scanned = 0, available = 0, error = null, truncated = false;
      const budget = AbortSignal.timeout(90000);
      const get = async url => {
        const response = await fetchImpl(url, { headers: { Accept: 'text/html', 'User-Agent': 'JobFinderExtreme/1.0 (local job search)' }, signal: AbortSignal.any([budget, AbortSignal.timeout(15000)]) });
        if (!response.ok) {
          if ([403, 429].includes(response.status)) blockedUntil = now() + 15 * 60000;
          throw new Error(`Dice returned HTTP ${response.status}.`);
        }
        const html = await response.text();
        if (html.length > 16000000) throw new Error('Dice returned an oversized page.');
        return html;
      };
      const maxPages = filters.depth === 'deep' ? 40 : 20;
      try {
        for (let page = 1; page <= maxPages; page++) {
          const url = new URL('https://www.dice.com/jobs');
          url.search = new URLSearchParams({ q: query, countryCode: 'US', 'filters.workplaceTypes': 'Remote', page: String(page), ...(range ? { 'filters.postedDate': range } : {}) });
          const result = parseDiceSearch(await get(url)); pages++; available = result.total;
          const cards = result.jobs.filter(card => { if (seen.has(card.guid)) return false; seen.add(card.guid); return true; });
          scanned += cards.length;
          let cursor = 0;
          const workers = await Promise.allSettled(Array.from({ length: Math.min(4, cards.length) }, async () => {
            while (cursor < cards.length && blockedUntil <= now()) {
              const card = cards[cursor++];
              if (!isSoftwareJob(card.title)) continue;
              const posted = Date.parse(card.postedDate);
              if (days && (!Number.isFinite(posted) || now() - posted > days * 86400000)) continue;
              const url = new URL(`/job-detail/${encodeURIComponent(card.guid)}`, SOURCE.url).href;
              let job = details.get(url);
              if (!job || job.expiresAt <= now()) {
                const schemas = jobPostingSchemas(await get(url));
                if (!schemas.length) throw new Error('Dice omitted the full posting data.');
                job = { value: normalizeSchemaPosting(schemas[0], { ...card, url }), expiresAt: now() + 15 * 60000 };
                if (details.size > 1500) details.delete(details.keys().next().value);
                details.set(url, job);
              }
              if (job.value) { jobs.push(job.value); onBatch?.([job.value]); }
            }
          }));
          const failed = workers.find(worker => worker.status === 'rejected');
          if (failed) throw failed.reason;
          onProgress?.({ source: 'Dice', query, pages, scanned, available, count: deduplicateJobs(jobs).length });
          if (!cards.length || page >= result.pageCount) break;
          if (page === maxPages) truncated = true;
        }
      } catch (cause) { error = ['TimeoutError', 'AbortError'].includes(cause.name) ? 'Dice reached its search time limit. Partial results are retained.' : cause.message; }
      truncated ||= scanned < available;
      const entry = { jobs: deduplicateJobs(jobs), scanned, pages, available, error, truncated, expiresAt: now() + (error ? 60000 : 15 * 60000) };
      if (cache.size > 30) cache.delete(cache.keys().next().value);
      cache.set(key, entry); return entry;
    })();
    inFlight.set(key, pending);
    try { return await pending; } finally { inFlight.delete(key); }
  }
  return {
    async getJobs(filters = {}, { onBatch, onProgress, signal } = {}) {
      const keywords = parseKeywords(String(filters.keywords || '')).slice(0, 3);
      const terms = keywords.length ? keywords : [String(filters.role || ({ backend: 'backend developer', frontend: 'frontend developer', fullstack: 'full stack developer', mobile: 'mobile developer', embedded: 'embedded software' }[filters.roleFocus]) || 'software engineer')];
      const jobs = [], errors = []; let pages = 0, scanned = 0, available = 0, truncated = false;
      for (const term of terms) {
        if (signal?.aborted) break;
        if (blockedUntil > now()) { errors.push('Dice public access was blocked. Paused for 15 minutes.'); break; }
        const result = await loadSearch(term, filters, batch => { if (!signal?.aborted) onBatch?.(batch); }, onProgress);
        jobs.push(...result.jobs); pages += result.pages; scanned += result.scanned; available += result.available; truncated ||= result.truncated;
        if (result.error) errors.push(result.error);
      }
      const unique = deduplicateJobs(jobs);
      return { jobs: unique, source: { ...SOURCE, count: unique.length, pages, scanned, available, truncated, queries: terms, queryCount: terms.length,
        error: errors.length ? [...new Set(errors)].join(' · ') : null, partial: errors.length > 0 && unique.length > 0,
        fetchedAt: new Date(now()).toISOString(), nextCheckAt: new Date(Math.max(blockedUntil, now() + 15 * 60000)).toISOString() } };
    },
  };
}
