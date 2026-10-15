import { normalize } from './sources.mjs';
import { plainText, isUSRemoteJob, salaryData, deduplicateJobs } from './jobs.mjs';

const SOURCE = { id: 'indeed', name: 'Indeed', url: 'https://www.indeed.com', note: 'Direct cross-company search using ts-jobspy. Full descriptions are checked locally. Date windows are requested upstream; remote eligibility is established from the posting text, never just the scraper flag. No personal account or API key. The library does not expose its page count.' };

export function normalizeIndeed(raw) {
  // The library's isRemote also matches isolated words in descriptions. An
  // incidental mention of remote servers or remote colleagues is not sufficient.
  const description = plainText(raw.description);
  const remote = /\bremote\b/i.test(`${raw.title} ${raw.location}`)
    || /\b(?:fully remote|100% remote|remote[- ](?:first|only)|work (?:location|arrangement)\s*:\s*remote|(?:this )?(?:role|position)\s+(?:is|will be)\s+(?:a\s+)?(?:fully )?remote|location\s*:\s*(?:100%\s+)?remote)\b/i.test(description);
  if (!remote) return null;
  const job = normalize(raw, SOURCE, { title: raw.title, company: raw.company, location: raw.location, workplace: 'remote',
    description, experience: raw.jobLevel, employmentType: raw.jobTypes?.join(', '), postedAt: raw.datePosted,
    postedDateLabel: 'Listed on Indeed', salary: salaryData(raw.minAmount, raw.maxAmount, raw.currency, raw.interval),
    applyUrl: raw.jobUrlDirect || raw.jobUrl, listingUrl: raw.jobUrl });
  return job && isUSRemoteJob(job) ? job : null;
}

export function indeedQueries(filters = {}) {
  const term = String(filters.role || ({ backend: 'backend developer', frontend: 'frontend developer', fullstack: 'full stack developer', mobile: 'mobile developer', embedded: 'embedded software engineer' }[filters.roleFocus]) || '').trim().slice(0, 120);
  return (term ? [term] : ['software engineer', 'software developer', 'backend developer', 'frontend developer', 'full stack developer', 'mobile developer']).map(term => `${term} remote`);
}

export function createIndeedService({ scrapeImpl, now = () => Date.now() } = {}) {
  const cache = new Map(), inFlight = new Map();
  let blockedUntil = 0;
  async function load(query, filters, remainingMs) {
    const days = Number(filters.days) > 0 ? Math.min(36500, Number(filters.days)) : 0;
    const limit = filters.depth === 'deep' ? 1000 : 500;
    const key = `${query}|${days}|${limit}`;
    const previous = cache.get(key);
    if (previous && previous.expiresAt > now()) return previous;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = (async () => {
      const scrapeJobs = scrapeImpl || (await import('ts-jobspy')).scrapeJobs;
      const result = await scrapeJobs({ sites: ['indeed'], searchTerm: query, location: 'United States', country: 'usa',
        // Indeed supports one filter group in this library version. Send dates
        // alone, include remote in the query, then verify every posting locally.
        ...(days ? { hoursOld: Math.ceil(days * 24) } : {}), resultsWanted: limit,
        descriptionFormat: 'html', timeoutMs: Math.max(1, Math.min(45000, remainingMs)), verbose: 0 });
      const status = result.meta?.sites?.[0];
      const error = typeof status?.error === 'string' ? status.error : status?.error?.message || null;
      if (error && /429|403|rate limit|blocked/i.test(error)) blockedUntil = now() + 15 * 60000;
      const entry = { jobs: deduplicateJobs(result.jobs.map(normalizeIndeed).filter(Boolean)), scanned: result.jobs.length,
        error, truncated: result.jobs.length >= limit, partial: status?.status === 'partial', fetchedAt: new Date(now()).toISOString(), expiresAt: now() + (error ? 60000 : 15 * 60000) };
      if (cache.size >= 30) cache.delete(cache.keys().next().value);
      cache.set(key, entry); return entry;
    })();
    inFlight.set(key, pending);
    try { return await pending; } finally { inFlight.delete(key); }
  }
  return {
    async getJobs(filters = {}, { signal, onBatch, onProgress } = {}) {
      const jobs = [], errors = [], queries = [];
      const deadline = Date.now() + 90000;
      let scanned = 0, truncated = false, partial = false;
      for (const query of indeedQueries(filters)) {
        if (signal?.aborted) break;
        if (Date.now() >= deadline) { errors.push('Indeed reached its 90-second search budget. Partial results are retained.'); break; }
        if (blockedUntil > now()) { errors.push('Indeed public access was blocked. Paused for 15 minutes.'); break; }
        queries.push(query);
        onProgress?.({ source: 'Indeed · searching full postings', query });
        try {
          const entry = await load(query, filters, deadline - Date.now());
          jobs.push(...entry.jobs); scanned += entry.scanned; truncated ||= entry.truncated; partial ||= entry.partial;
          if (entry.error) errors.push(entry.error);
          if (!signal?.aborted) { onBatch?.(entry.jobs); onProgress?.({ source: 'Indeed', query, scanned, count: deduplicateJobs(jobs).length }); }
        } catch (cause) { errors.push(cause.code === 'ERR_MODULE_NOT_FOUND' ? 'Install dependencies with npm install, then restart.' : cause.message); break; }
      }
      const unique = deduplicateJobs(jobs);
      return { jobs: unique, source: { ...SOURCE, count: unique.length, scanned, pages: null, queries, queryCount: queries.length,
        error: errors.length ? [...new Set(errors)].join(' · ') : null, partial: partial || (errors.length > 0 && unique.length > 0), truncated,
        fetchedAt: new Date(now()).toISOString(), nextCheckAt: new Date(Math.max(blockedUntil, now() + 15 * 60000)).toISOString() } };
    },
  };
}
