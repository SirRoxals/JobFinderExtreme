import { createJobService, normalizeFreehire, normalizeWorkable, normalizeHimalayas, normalizeJobicy, normalizeRemotive, normalizeRemoteOK, normalizeWWR, normalizeNomads } from './sources.mjs';
import { deduplicateJobs, isSoftwareJob, isUSRemoteJob, parseKeywords } from './jobs.mjs';
import { createLinkedInService } from './linkedin.mjs';
import { createIndeedService } from './indeed.mjs';

const HOUR = 3600000;
export function searchPlan(input = {}) {
  const depth = input.depth === 'deep' ? 'deep' : 'standard';
  const text = String(input.role || '').trim().slice(0, 120);
  const skills = parseKeywords(String(input.keywords || '').slice(0, 500));
  const focus = { backend: 'backend', frontend: 'frontend', fullstack: 'full stack', mobile: 'mobile developer', embedded: 'embedded software' }[input.roleFocus];
  const terms = text ? [text, `${text} software`] : focus ? [focus, `${focus} engineer`] : ['software engineer', 'software developer', 'backend', 'frontend', 'full stack', 'mobile developer', 'web developer', 'application developer', 'java developer', '.net developer', 'python developer', 'ios developer', 'android developer'];
  if (skills.length) terms.push(`software ${skills[0]}`, ...skills.slice(1, depth === 'deep' ? 3 : 2).map(skill => `developer ${skill}`));
  const workableDays = ['1', '3', '7'].includes(String(input.days)) ? '7' : input.days === '' || input.days === 'custom' ? '0' : '30';
  const catalogParams = new URLSearchParams({ countries: 'US', work_mode: 'remote', category: 'software_engineering,backend,frontend,fullstack,mobile,embedded', sort: 'posted_at', order: 'desc', limit: '100' });
  // Download full descriptions in bulk, not snippets that cannot support keyword
  // or experience checks. Skills stay local so ALL/ANY retain identical semantics.
  if (text) catalogParams.set('q', text);
  if (Number(input.days) > 0) catalogParams.set('posted_within_days', String(Math.min(36500, Math.ceil(Number(input.days)))));
  else if (input.days === 'custom' && /^\d{4}-\d\d-\d\d$/.test(input.dateFrom || '')) {
    const age = Math.ceil((Date.now() - new Date(`${input.dateFrom}T00:00:00`).getTime()) / 86400000) + 1;
    if (age > 0) catalogParams.set('posted_within_days', String(age));
  }
  const specs = [{
    id: 'freehire', name: 'Freehire', url: 'https://freehire.me', format: 'catalog', pagination: 'catalog', normalize: normalizeFreehire,
    endpoint: `https://freehire.me/api/v1/agent/jobs/search?${catalogParams}`, maxPages: 100, budgetMs: 180000, ttl: 15 * 60000,
    note: 'Broad public cross-company index covering ATS platforms and job boards. Reads full descriptions, 100 postings per page, automatically to the end (up to the index\'s 10,000-result boundary). Country and remote metadata are checked against listing text. Source dates may reflect reposts.',
  }, ...[...new Set(terms)].map((query, index) => ({
    id: `workable-query-${index}`, providerId: 'workable', name: 'Workable', url: 'https://jobs.workable.com', query,
    endpoint: `https://jobs.workable.com/api/v1/jobs?${new URLSearchParams({ query, location: 'United States', workplace: 'remote', day_range: workableDays })}`,
    pagination: 'token', normalize: normalizeWorkable, maxPages: depth === 'deep' ? 50 : 15, budgetMs: 90000, ttl: 30 * 60000,
    note: 'Cross-company public job search using your role and skill queries. US and remote are requested upstream and checked again locally. No employer list.',
  }))];
  const himalayasTerms = text ? [text] : focus ? [focus] : ['software', 'developer'];
  if (skills.length) himalayasTerms.push(skills[0]);
  for (const [index, query] of [...new Set(himalayasTerms)].entries()) specs.push({
    id: `himalayas-query-${index}`, providerId: 'himalayas', name: 'Himalayas', url: 'https://himalayas.app', query,
    endpoint: `https://himalayas.app/jobs/api/search?${new URLSearchParams({ q: query, country: 'US', exclude_worldwide: 'true', sort: 'recent' })}`,
    pagination: 'page', normalize: normalizeHimalayas, maxPages: depth === 'deep' ? 40 : 12, budgetMs: 90000, ttl: 24 * HOUR,
    note: 'Cross-company country/keyword search. Upstream data refreshes daily; deeper searches read more pages. Anonymous access may change.',
  });
  specs.push(
    { id: 'jobicy', name: 'Jobicy', url: 'https://jobicy.com', endpoint: 'https://jobicy.com/api/v2/remote-jobs?count=200&industry=engineering&geo=usa', pagination: 'cursor', normalize: normalizeJobicy, maxPages: 20, budgetMs: 60000, ttl: HOUR, note: 'US engineering feed, past 7 days, with a 3-hour upstream delay.' },
    { id: 'remotive', name: 'Remotive', url: 'https://remotive.com', endpoint: 'https://remotive.com/api/remote-jobs?category=software-dev', normalize: normalizeRemotive, ttl: 6 * HOUR, note: 'Public software feed; 24-hour upstream delay. Cached for 6 hours.' },
    { id: 'remoteok', name: 'Remote OK', url: 'https://remoteok.com', endpoint: 'https://remoteok.com/api', format: 'array', normalize: normalizeRemoteOK, ttl: HOUR, note: 'Recent public remote listings. Only explicit US locations pass verification.' },
    { id: 'weworkremotely', name: 'We Work Remotely', url: 'https://weworkremotely.com', endpoint: 'https://weworkremotely.com/categories/remote-programming-jobs.rss', format: 'rss', normalize: normalizeWWR, ttl: HOUR, note: 'Programming RSS feed; company headquarters is never used as proof of US job eligibility.' },
    { id: 'workingnomads', name: 'Working Nomads', url: 'https://www.workingnomads.com', endpoint: 'https://www.workingnomads.com/api/exposed_jobs/', format: 'array', normalize: normalizeNomads, ttl: HOUR, note: 'Public remote job feed, filtered again for software development and explicit US eligibility.' },
  );
  return specs;
}

export function createSearchService({ fetchImpl = fetch, now = () => Date.now(), linkedinService, indeedService } = {}) {
  const cache = new Map(), inFlight = new Map(), pageCache = new Map();
  const linkedin = linkedinService || createLinkedInService({ fetchImpl, now });
  const indeed = indeedService || createIndeedService({ now });
  return {
    async getJobs(filters = {}, { onProgress, onBatch, signal } = {}) {
      const specs = searchPlan(filters);
      let discovered = [], completed = 0, linkedInDone = false, indeedDone = false;
      const publish = batch => {
        if (signal?.aborted || !batch.length) return;
        const ids = new Set(discovered.map(job => job.id));
        discovered = deduplicateJobs([...discovered, ...batch.filter(job => isSoftwareJob(job.title) && isUSRemoteJob(job))]);
        const fresh = discovered.filter(job => !ids.has(job.id));
        if (fresh.length) onBatch?.(fresh);
      };
      const report = event => {
        if (signal?.aborted) return;
        if (event.completed !== undefined) completed = event.completed;
        onProgress?.({ ...event, completed: completed + Number(linkedInDone) + Number(indeedDone), total: specs.length + 2 });
      };
      report({ source: 'Searching the broad catalogue and job boards' });
      const [result, direct, indeedResult] = await Promise.all([
        createJobService({ searchSources: specs, maxPages: 1, maxConcurrent: 5, requestTimeoutMs: 15000, onProgress: report, onBatch: publish, signal }, { fetchImpl, now, cache, inFlight, pageCache }).getJobs(),
        linkedin.getJobs(filters, { onProgress: report, onBatch: publish, signal }).then(result => { linkedInDone = true; report({ source: 'LinkedIn search finished' }); return result; }),
        indeed.getJobs(filters, { onProgress: report, onBatch: publish, signal }).then(result => { indeedDone = true; report({ source: 'Indeed search finished' }); return result; }),
      ]);
      const grouped = new Map();
      for (const item of result.sources) {
        const current = grouped.get(item.id);
        if (!current) grouped.set(item.id, { ...item, queries: item.query ? [item.query] : [], pages: item.pages || 0, queryCount: 1 });
        else {
          if (item.query) current.queries.push(item.query);
          current.pages += item.pages || 0; current.queryCount++;
          current.scanned += item.scanned || 0;
          current.truncated ||= item.truncated; current.stale ||= item.stale; current.partial ||= item.partial;
          if (item.error) current.error = item.error;
        }
      }
      const jobs = deduplicateJobs([...result.jobs, ...direct.jobs, ...indeedResult.jobs]).filter(job => isSoftwareJob(job.title) && isUSRemoteJob(job));
      const sources = [...grouped.values(), direct.source, indeedResult.source].map(source => ({ ...source, count: jobs.filter(job => job.sourceId === source.id).length }));
      return { ...result, jobs, sources, search: { depth: filters.depth === 'deep' ? 'deep' : 'standard', queryCount: specs.length + 1 + indeedResult.source.queryCount, pages: sources.reduce((sum, source) => sum + (source.pages || 0), 0), scanned: sources.reduce((sum, source) => sum + (source.scanned || 0), 0), companies: new Set(jobs.map(job => job.company.toLowerCase())).size, origins: [...new Set(sources.flatMap(source => source.origins || []))], limited: sources.some(source => source.truncated), scope: 'US fully remote individual-contributor software development' } };
    },
  };
}
