import { load } from 'cheerio';
import { jobPostingSchemas, normalizeSchemaPosting } from './dice.mjs';
import { deduplicateJobs, isSoftwareJob, parseKeywords } from './jobs.mjs';

const SOURCE = { id: 'builtin', name: 'Built In', url: 'https://builtin.com', note: 'Direct public US remote searches, followed by full posting-page checks. Explicit posted/reposted hour labels are retained as conservative time ranges; date edits and crawler discovery times are not posting evidence.' };

export function relativePostingWindow(text, now) {
  const match = text.match(/\b(Reposted|Posted)\s+(\d+)\s+(Minute|Hour|Day)s?\s+Ago\b/i);
  if (!match) return null;
  const unit = { minute: 60000, hour: 3600000, day: 86400000 }[match[3].toLowerCase()];
  return { latest: new Date(now - Number(match[2]) * unit).toISOString(), earliest: new Date(now - (Number(match[2]) + 1) * unit).toISOString(),
    precision: match[3].toLowerCase(), reposted: /^reposted$/i.test(match[1]) };
}

export function parseBuiltinSearch(html, now = Date.now()) {
  const $ = load(html);
  const cards = $('[data-id="job-card"]').map((_, el) => {
    const card = $(el), a = card.find('a[data-id="job-card-title"]');
    const href = a.attr('href');
    if (!href?.startsWith('/job/')) return null;
    const posted = card.find('[x-show="!showSavedTag"]').text().trim() || card.text();
    return { url: new URL(href, SOURCE.url).href, title: a.text().trim(), window: relativePostingWindow(posted, now),
      companyName: card.find('[data-id="company-title"]').text().trim(),
      arrangement: card.find('.fa-house-building').parent().next().text().trim() };
  }).get().filter(Boolean);
  if (!cards.length && !/no (?:matching )?(?:jobs|results)|0 jobs/i.test($('body').text())) throw new Error('Built In returned an unrecognized search page.');
  return cards;
}

export function normalizeBuiltin(schema, card) {
  if (/hybrid|in-office or remote|on-site/i.test(card.arrangement || '')) return null;
  const job = normalizeSchemaPosting(schema, card, SOURCE);
  if (!job) return null;
  const range = card.window;
  if (range) {
    job.postedAt = range.latest;
    job.postedNotBefore = range.earliest;
    job.postedAtPrecision = range.precision;
    job.postedDateLabel = range.reposted ? 'Reposted on Built In (approx.)' : 'Posted on Built In (approx.)';
    job.dateCaution = `Source time range: ${range.earliest} through ${range.latest}. ${range.reposted ? `This is a repost; the original source date is ${schema.datePosted || 'not supplied'}.` : 'The source reports a relative time, not an exact timestamp.'}`;
  }
  return job;
}

export function createBuiltinService({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const cache = new Map(), inFlight = new Map();
  let blockedUntil = 0;
  return {
    async getJobs(filters = {}, { onBatch, onProgress, signal } = {}) {
      const words = parseKeywords(String(filters.keywords || ''));
      const query = String(filters.role || words[0] || ({ backend: 'backend', frontend: 'frontend', fullstack: 'full stack', mobile: 'mobile', embedded: 'embedded' }[filters.roleFocus]) || 'software engineer').slice(0, 120);
      const days = Number(filters.days) > 0 ? Number(filters.days) : 0;
      const key = `${query}|${days}|${filters.depth}`;
      const wrap = entry => ({ jobs: entry.jobs, source: { ...SOURCE, count: entry.jobs.length, scanned: entry.scanned, pages: entry.pages, queries: [query], queryCount: 1,
        truncated: entry.truncated, error: entry.error, partial: !!entry.error && entry.jobs.length > 0, fetchedAt: entry.fetchedAt, nextCheckAt: new Date(entry.expiresAt).toISOString() } });
      const prior = cache.get(key);
      if (prior && prior.expiresAt > now()) { onBatch?.(prior.jobs); return wrap(prior); }
      if (inFlight.has(key)) { const entry = await inFlight.get(key); onBatch?.(entry.jobs); return wrap(entry); }
      if (blockedUntil > now()) return wrap({ jobs: [], scanned: 0, pages: 0, error: 'Built In public access was blocked. Paused for 15 minutes.', fetchedAt: null, expiresAt: blockedUntil });
      const pending = (async () => {
        const jobs = [], seen = new Set(); let scanned = 0, pages = 0, error = null, truncated = false;
        const deadline = AbortSignal.timeout(90000);
        const get = async url => {
          const r = await fetchImpl(url, { headers: { Accept: 'text/html', 'User-Agent': 'JobFinderExtreme/1.0 (local job search)' }, signal: AbortSignal.any([deadline, AbortSignal.timeout(15000)]) });
          if (!r.ok) { if ([403, 429].includes(r.status)) blockedUntil = now() + 15 * 60000; throw new Error(`Built In returned HTTP ${r.status}.`); }
          const text = await r.text(); if (text.length > 16000000) throw new Error('Built In returned an oversized page.'); return text;
        };
        try {
          const maxPages = filters.depth === 'deep' ? 30 : 15;
          for (let page = 1; page <= maxPages && !signal?.aborted; page++) {
            const u = new URL('https://builtin.com/jobs/remote');
            u.search = new URLSearchParams({ search: query, page: String(page), ...(days ? { daysSinceUpdated: String(Math.ceil(days)) } : {}) });
            const rows = parseBuiltinSearch(await get(u), now()); pages++;
            const cards = rows.filter(card => { if (seen.has(card.url)) return false; seen.add(card.url); return true; });
            if (!cards.length) break;
            scanned += cards.length; let cursor = 0;
            const workers = await Promise.allSettled(Array.from({ length: Math.min(4, cards.length) }, async () => {
              while (cursor < cards.length && blockedUntil <= now() && !signal?.aborted) {
                const card = cards[cursor++];
                if (!isSoftwareJob(card.title) || /hybrid|in-office or remote|on-site/i.test(card.arrangement)) continue;
                if (days && card.window && now() - Date.parse(card.window.earliest) > days * 86400000) continue;
                const schema = jobPostingSchemas(await get(card.url))[0];
                if (!schema) throw new Error('Built In omitted the full posting data.');
                const job = normalizeBuiltin(schema, card);
                if (job) { jobs.push(job); if (!signal?.aborted) onBatch?.([job]); }
              }
            }));
            const failed = workers.find(worker => worker.status === 'rejected'); if (failed) throw failed.reason;
            onProgress?.({ source: 'Built In', pages, scanned, count: jobs.length });
            if (rows.length < 25) break;
            if (page === maxPages) truncated = true;
          }
        } catch (cause) { error = ['TimeoutError', 'AbortError'].includes(cause.name) ? 'Built In reached its search time limit. Partial results are retained.' : cause.message; }
        const entry = { jobs: deduplicateJobs(jobs), scanned, pages, error, truncated, fetchedAt: new Date(now()).toISOString(), expiresAt: now() + (error ? 60000 : 15 * 60000) };
        if (cache.size > 20) cache.delete(cache.keys().next().value); cache.set(key, entry); return entry;
      })();
      inFlight.set(key, pending);
      try { return wrap(await pending); } finally { inFlight.delete(key); }
    },
  };
}
