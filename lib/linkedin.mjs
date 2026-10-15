import { normalize } from './sources.mjs';
import { plainText, decodeEntities, isSoftwareJob, isUSRemoteJob, isUSLocation, safeUrl, salaryData, parseSalary } from './jobs.mjs';

const SOURCE = { id: 'linkedin', name: 'LinkedIn', url: 'https://www.linkedin.com/jobs/', note: 'Direct public guest search, followed by posting-page checks. Search filters alone are not proof of remote work. Stops on blocking; never uses accounts, cookies, or proxy rotation.' };

// Read an element without executing HTML. Matching nested tags preserves the full
// description; a non-greedy <div> regex would silently cut it at the first child.
export function classContent(html, name) {
  const open = /<([a-z][\w:-]*)\b[^>]*\bclass\s*=\s*(["'])(.*?)\2[^>]*>/gi;
  for (const match of html.matchAll(open)) {
    if (!match[3].split(/\s+/).includes(name)) continue;
    const tag = match[1], start = match.index + match[0].length;
    const tokens = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    tokens.lastIndex = start;
    let depth = 1, token;
    while ((token = tokens.exec(html))) {
      depth += token[1] ? -1 : /\/>$/.test(token[0]) ? 0 : 1;
      if (!depth) return html.slice(start, token.index);
    }
    return '';
  }
  return '';
}

export function parseLinkedInCards(html) {
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].flatMap(([, card]) => {
    const id = card.match(/urn:li:jobPosting:(\d+)/)?.[1];
    if (!id) return [];
    return [{ id, title: plainText(classContent(card, 'base-search-card__title')), company: plainText(classContent(card, 'base-search-card__subtitle')),
      location: plainText(classContent(card, 'job-search-card__location')), postedAt: card.match(/<time\b[^>]*datetime=["']([^"']+)/i)?.[1],
      salaryText: plainText(classContent(card, 'job-search-card__salary-info')), url: `https://www.linkedin.com/jobs/view/${id}` }];
  });
}

export function parseLinkedInPosting(html, card, now = Date.now()) {
  let schema;
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      let data;
      try { data = JSON.parse(match[1]); } catch { data = JSON.parse(decodeEntities(match[1])); }
      schema = (Array.isArray(data) ? data : [data, ...(data['@graph'] || [])]).find(item => item?.['@type'] === 'JobPosting');
      if (schema) break;
    } catch { /* A malformed block cannot establish eligibility. */ }
  }
  const description = plainText(schema?.description || classContent(html, 'show-more-less-html__markup'));
  if (!description) return null; // No title-only results: keywords and requirements need the full text.
  const title = plainText(schema?.title || card.title);
  const workplaceText = `${card.location} ${title}`;
  const explicitProse = /\b(?:fully remote|100% remote|remote[- ](?:first|only)|(?:this (?:role|position)|work (?:arrangement|location)|location)\s*(?:is|:|will be)\s*(?:fully |100% )?remote|(?:role|position)\s+is\s+(?:a\s+)?remote|work from (?:anywhere in|home (?:in|within)) (?:the )?(?:u\.?s\.?|united states))\b/i.test(description);
  const remote = schema?.jobLocationType === 'TELECOMMUTE' || /\bremote\b/i.test(workplaceText) || explicitProse;
  if (!remote) return null; // LinkedIn's f_WT=2 is not reliable on its own.
  const addresses = (Array.isArray(schema?.jobLocation) ? schema.jobLocation : [schema?.jobLocation]).filter(Boolean).map(item => item.address || {});
  const restrictions = (Array.isArray(schema?.applicantLocationRequirements) ? schema.applicantLocationRequirements : [schema?.applicantLocationRequirements]).filter(Boolean);
  const location = [...new Set([card.location, ...addresses.flatMap(a => [a.addressLocality, a.addressRegion, a.addressCountry]), ...restrictions.map(a => a.name)].filter(Boolean))].join(' · ');
  if (!isUSLocation(location)) return null;
  const expiry = Date.parse(schema?.validThrough);
  if (Number.isFinite(expiry) && expiry < now) return null;
  const pay = schema?.baseSalary;
  const salary = pay?.value ? salaryData(pay.value.minValue || pay.value.value, pay.value.maxValue, pay.currency, pay.value.unitText) : parseSalary(card.salaryText);
  const job = normalize(card, SOURCE, { title, company: schema?.hiringOrganization?.name || card.company, location, workplace: 'remote',
    description, postedAt: schema?.datePosted || card.postedAt, salary, applyUrl: card.url, listingUrl: card.url, employmentType: schema?.employmentType });
  return job && isUSRemoteJob(job) ? job : null;
}

const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  signal?.addEventListener('abort', abort, { once: true });
});

export function createLinkedInService({ fetchImpl = fetch, now = () => Date.now(), delayMs = 1000 } = {}) {
  const cache = new Map();
  let active, blockedUntil = 0;
  const empty = (error) => ({ jobs: [], source: { ...SOURCE, count: 0, pages: 0, scanned: 0, queries: [], error, fetchedAt: null, nextCheckAt: new Date(blockedUntil || now()).toISOString() } });
  return {
    async getJobs(filters = {}, { onBatch, onProgress, signal } = {}) {
      const term = String(filters.role || ({ backend: 'backend engineer', frontend: 'frontend engineer', fullstack: 'full stack developer', mobile: 'mobile developer', embedded: 'embedded software engineer' }[filters.roleFocus]) || 'software engineer').slice(0, 120);
      const days = Number(filters.days) > 0 ? Number(filters.days) : 0;
      const key = `${term}|${days}|${filters.depth}`;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) { onBatch?.(cached.result.jobs); return cached.result; }
      if (blockedUntil > now()) return empty('LinkedIn rate limited public access. Paused for 15 minutes; other indexes keep searching.');
      // One public LinkedIn crawl at a time, including across browser tabs.
      if (active) { await active; if (signal?.aborted) return empty('Search cancelled.'); return this.getJobs(filters, { onBatch, onProgress, signal }); }
      active = (async () => {
        const jobs = [], seen = new Set(); let pages = 0, scanned = 0, checked = 0, truncated = false, error = null;
        const budget = AbortSignal.any([AbortSignal.timeout(90000), ...(signal ? [signal] : [])]);
        const maxPages = filters.depth === 'deep' ? 12 : 6, maxDetails = filters.depth === 'deep' ? 120 : 60;
        const get = async url => {
          await pause(delayMs, budget);
          const response = await fetchImpl(url, { headers: { Accept: 'text/html', 'User-Agent': 'JobFinderExtreme/1.0 (local job search)' }, signal: AbortSignal.any([budget, AbortSignal.timeout(15000)]), redirect: 'error' });
          if (!response.ok) {
            if ([429, 403, 999].includes(response.status)) blockedUntil = now() + 15 * 60000;
            throw new Error(response.status === 429 ? 'LinkedIn rate limited public access. Paused for 15 minutes.' : `LinkedIn returned HTTP ${response.status}.`);
          }
          const text = await response.text();
          if (text.length > 16000000) throw new Error('LinkedIn returned an oversized response.');
          if (/<title>\s*(?:sign in|join linkedin|security verification)/i.test(text)) throw new Error('LinkedIn requires sign-in or verification. Other indexes remain available.');
          return text;
        };
        try {
          for (let page = 0; page < maxPages; page++) {
            const url = new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
            url.search = new URLSearchParams({ keywords: term, location: 'United States', geoId: '103644278', f_WT: '2', sortBy: 'DD', start: String(page * 25), ...(days ? { f_TPR: `r${days * 86400}` } : {}) });
            const html = await get(url);
            const cards = parseLinkedInCards(html); pages++;
            if (!cards.length && html.trim()) throw new Error('LinkedIn returned an unrecognized search page.');
            let added = 0;
            for (const card of cards) {
              if (seen.has(card.id)) continue;
              seen.add(card.id); scanned++; added++;
              if (!isSoftwareJob(card.title) || !isUSLocation(card.location)) continue;
              if (checked >= maxDetails) { truncated = true; break; }
              checked++;
              const job = parseLinkedInPosting(await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${card.id}`), card, now());
              if (job) { jobs.push(job); onBatch?.([job]); }
              onProgress?.({ source: 'LinkedIn · verifying posting pages', pages, scanned, count: jobs.length });
            }
            if (truncated || cards.length < 25 || !added) break;
            if (page === maxPages - 1) truncated = true;
          }
        } catch (cause) { error = ['TimeoutError', 'AbortError'].includes(cause.name) ? 'LinkedIn search stopped at its time limit or was cancelled. Partial results are retained.' : cause.message; }
        const result = { jobs, source: { ...SOURCE, count: jobs.length, scanned, pages, queries: [term], queryCount: 1, truncated, partial: !!error && jobs.length > 0, error,
          fetchedAt: new Date(now()).toISOString(), nextCheckAt: new Date(Math.max(blockedUntil, now() + 15 * 60000)).toISOString() } };
        if (cache.size >= 20) cache.delete(cache.keys().next().value);
        cache.set(key, { expiresAt: now() + 15 * 60000, result });
        return result;
      })();
      try { return await active; } finally { active = undefined; }
    },
  };
}
