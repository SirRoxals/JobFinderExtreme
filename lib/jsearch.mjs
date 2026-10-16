import { normalize } from './sources.mjs';
import { deduplicateJobs, isUSRemoteJob, isUSLocation, parseKeywords, salaryData, plainText, safeUrl } from './jobs.mjs';

const SOURCE = { id: 'jsearch', name: 'JSearch', url: 'https://www.openwebninja.com/api/jsearch', note: 'Optional Google for Jobs index, searched only when requested. Full descriptions and explicit US/remote evidence are checked locally. Dates are publisher-reported; reposts and source date precision can affect freshness. Each fetched page uses one API request credit.' };
const BASE = 'https://api.openwebninja.com';
const TTL = 15 * 60000;
const fail = (message, status = 502) => Object.assign(new Error(message), { status });

export function jsearchQueries(filters = {}) {
  const role = String(filters.role || '').trim().slice(0, 120);
  const focus = { backend: 'backend developer', frontend: 'frontend developer', fullstack: 'full stack developer', mobile: 'mobile developer', embedded: 'embedded software engineer' }[filters.roleFocus];
  const skills = parseKeywords(String(filters.keywords || '').slice(0, 500)).slice(0, 3);
  const families = role ? [role] : focus ? [focus] : ['software engineer', 'software developer', 'backend developer', 'full stack developer', 'frontend developer', 'mobile developer'];
  const terms = skills.length ? skills.flatMap(skill => families.slice(0, 4).map(family => `${skill} ${family}`)) : families;
  // Publisher-specific queries expose results hidden behind one national query's
  // relevance ranking. These still use JSearch, not blocked board scrapers.
  const national = [...new Set(terms)].map(term => `${term} remote jobs in United States`);
  const publishers = ['LinkedIn', 'Indeed', 'Dice', 'ZipRecruiter', 'Glassdoor'];
  return [...national, ...publishers.flatMap(publisher => national.slice(0, 2).map(query => `${query} via ${publisher}`))];
}

export function jsearchDateWindow(days) {
  const value = Number(days);
  return value > 0 ? value <= 1 ? 'today' : value <= 3 ? '3days' : value <= 7 ? 'week' : value <= 30 ? 'month' : 'all' : 'all';
}

export function jsearchLocation(raw) {
  const country = String(raw.job_country || '').toUpperCase();
  if (country && country !== 'US') return '';
  const place = [raw.job_location, raw.job_city, raw.job_state].filter(Boolean).join(' · ');
  if (/\b(?:Canada|United Kingdom|India|Germany|Pakistan|Philippines|Toronto|Ontario|London|Australia|Singapore|Netherlands)\b/i.test(place) && !isUSLocation(place)) return '';
  if (country === 'US') return [place, 'United States'].filter(Boolean).join(' · ');
  if (isUSLocation(place)) return place;
  // Remote Google results often say "Anywhere" with no job_country. Accept
  // explicit JOB location/eligibility prose, never a US client or head office.
  const description = plainText(raw.job_description || '');
  const labeled = [...description.matchAll(/(?:^|\n)\s*(?:(?:job|role|work|primary)\s+)?locations?\s*(?::|[-–]|\n)\s*([^\n]{2,220})/gi)].map(match => match[1]);
  const eligible = [...description.matchAll(/\b(?:candidates? (?:must|should)|(?:you|applicants?) (?:must|need to)|must|required to)\s+(?:be\s+)?(?:located|based|reside|resident)\s+(?:in|within)\s+(?:the\s+)?(?:United States|U\.?S\.?A?\.?)\b[^.\n]{0,80}/gi)].map(match => match[0]);
  const availability = [...description.matchAll(/\b(?:this (?:role|position|job|opportunity) (?:is )?(?:open|available)|the offer is available)\s+(?:only\s+)?(?:in|from|to|for)\s*:?\s*([^\n.]{2,180})/gi)].map(match => match[1]);
  const titlePlace = String(raw.job_title || '').match(/\b(?:in|based in)\s+([^\n]{2,100})$/i)?.[1];
  return [...labeled, ...eligible, ...availability, titlePlace].find(value => value && isUSLocation(value))?.slice(0, 220) || '';
}

export function normalizeJSearch(raw) {
  if (!raw || !plainText(raw.job_description)) return null;
  if (raw.has_management_responsibilities === true || raw.job_is_remote === false || ['hybrid', 'onsite', 'on-site'].includes(String(raw.work_arrangement).toLowerCase())) return null;
  const location = jsearchLocation(raw);
  if (!location) return null;
  const direct = raw.apply_options?.find(option => option.is_direct && safeUrl(option.apply_link));
  const pay = salaryData(raw.job_min_salary, raw.job_max_salary, raw.job_salary_currency, raw.job_salary_period);
  pay.text = plainText(raw.job_salary_string || raw.job_salary || '');
  const job = normalize({ id: raw.job_id }, SOURCE, {
    title: raw.job_title, company: raw.employer_name, description: raw.job_description,
    location, workplace: raw.job_is_remote === true || raw.work_arrangement === 'remote' ? 'remote' : 'unknown',
    experience: raw.seniority_level, employmentType: raw.job_employment_type,
    postedAt: raw.job_posted_at_datetime_utc || raw.job_posted_at_timestamp,
    postedDateLabel: 'Publisher posted · JSearch', salary: pay,
    applyUrl: direct?.apply_link || raw.job_apply_link, listingUrl: raw.job_apply_link,
  });
  if (!job || !isUSRemoteJob(job)) return null;
  job.origin = plainText(raw.job_publisher || 'Google for Jobs');
  job.sourceName = `JSearch · ${job.origin}`;
  job.dateCaution = 'The publisher supplies this posting date. It can reflect a repost; an exact-looking timestamp does not prove first publication.';
  return job;
}

function readQuota(payload) {
  const data = payload?.data;
  const quota = data?.quotas?.find(item => /^requests?$/i.test(item.name)) || (data?.quotas?.length === 1 ? data.quotas[0] : null);
  if (!quota || !['limit', 'used', 'remaining'].every(key => Number.isFinite(quota[key]) && quota[key] >= 0)) throw fail('JSearch did not provide a usable request allowance. Check your plan in the provider portal.');
  return { limit: quota.limit, used: quota.used, remaining: quota.remaining, resetAt: quota.reset_at || null,
    plan: plainText(data.plan?.nickname || data.plan?.key || 'JSearch').slice(0, 60), active: data.status === 'active' };
}

export function createJSearchService({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  let apiKey = '', requestLimit = 20, quota = null, revision = 0, active = null;
  const pageCache = new Map(), resultCache = new Map();
  const status = () => ({ connected: !!apiKey, requestLimit, quota: quota ? { ...quota } : null, searching: !!active });
  async function request(path, params, key, signal) {
    const url = new URL(path, BASE); url.search = new URLSearchParams(params);
    let response, payload;
    try {
      response = await fetchImpl(url, { headers: { 'x-api-key': key, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(25000)]) });
      if (!response.ok) throw Object.assign(fail([401, 403].includes(response.status) ? 'JSearch rejected this key or subscription. Check the key and activate a JSearch plan.' : response.status === 429 ? 'JSearch reached its quota or rate limit. Available results are retained.' : `JSearch returned HTTP ${response.status}.`, response.status === 429 ? 429 : 502), { stop: [401, 403, 429].includes(response.status) });
      payload = await response.json();
    } catch (error) {
      // Never expose provider bodies, request headers, or fetch error objects.
      if (error.status) throw error;
      throw fail(signal?.aborted ? 'JSearch was cancelled. Available results are retained.' : 'JSearch could not finish the request. Check your connection and try again.');
    }
    if (payload?.status !== 'OK') throw fail('JSearch returned an unsuccessful response. Check the provider portal.');
    return payload;
  }
  function disconnect() { revision++; active?.abort(); apiKey = ''; quota = null; pageCache.clear(); resultCache.clear(); return status(); }
  return {
    status,
    disconnect,
    setRequestLimit(limit) {
      if (!apiKey) throw fail('Enter an API key to connect.', 400);
      if (active) throw fail('Wait for the current JSearch search to finish before changing its limit.', 409);
      if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw fail('Choose a request limit between 1 and 40.', 400);
      requestLimit = limit; return status();
    },
    async connect(key, limit = 20) {
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(key.trim())) throw fail('Enter a valid API key.', 400);
      if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw fail('Choose a request limit between 1 and 40.', 400);
      disconnect(); const connection = revision;
      const allowance = readQuota(await request('/usage', { api_id: 'jsearch' }, key.trim()));
      if (connection !== revision) throw fail('The connection attempt was cancelled.', 409);
      apiKey = key.trim(); requestLimit = limit; quota = allowance;
      return status();
    },
    async getJobs(filters = {}, { onBatch, onProgress, signal } = {}) {
      if (filters.jsearch !== '1' || !apiKey) return { jobs: [], source: null };
      const queriesForSearch = jsearchQueries(filters), date = jsearchDateWindow(filters.days);
      const resultKey = JSON.stringify([queriesForSearch, date, requestLimit]);
      const cached = resultCache.get(resultKey);
      if (cached && cached.expiresAt > now()) { if (!signal?.aborted) onBatch?.(cached.result.jobs); return { ...cached.result, source: { ...cached.result.source, requestsUsed: 0, cacheHit: true } }; }
      if (active) return { jobs: [], source: { ...SOURCE, count: 0, pages: 0, scanned: 0, queryCount: 0, error: 'JSearch is already running in another search. Wait for it to finish.' } };
      const controller = new AbortController(); active = controller;
      const current = revision, key = apiKey;
      const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : []), AbortSignal.timeout(150000)]);
      const queue = queriesForSearch.map(query => ({ query, cursor: '', seen: new Set() }));
      const jobs = [], queries = new Set(), errors = []; let pages = 0, scanned = 0, requestsUsed = 0, error = null, truncated = false;
      try {
        const allowance = readQuota(await request('/usage', { api_id: 'jsearch' }, key, combined));
        if (current !== revision || combined.aborted) throw fail('JSearch was cancelled. Available results are retained.');
        quota = allowance;
        if (!quota.active || !quota.remaining) throw fail('No active JSearch request allowance remains. Free sources continue working.');
        while (queue.length && pages < requestLimit && !combined.aborted && current === revision) {
          const item = queue.shift();
          queries.add(item.query);
          const cacheKey = JSON.stringify([item.query, date, item.cursor]);
          let entry = pageCache.get(cacheKey);
          if (!entry || entry.expiresAt <= now()) {
            if (requestsUsed >= requestLimit || quota.remaining < 1) { truncated = true; break; }
            // Reserve before sending. Even a failed request may consume a credit.
            requestsUsed++; quota.remaining--; quota.used++;
            onProgress?.({ source: 'JSearch', query: item.query, pages, scanned, requestsUsed, requestLimit });
            let response;
            try {
              response = await request('/jsearch/search-v2', { query: item.query, country: 'us', language: 'en', work_from_home: 'true', date_posted: date, num_pages: '1', ...(item.cursor ? { cursor: item.cursor } : {}) }, key, combined);
            } catch (cause) {
              errors.push(cause.status ? cause.message : 'A JSearch query could not finish.');
              truncated = true;
              if (cause.stop || combined.aborted) break;
              continue; // One failed query must not hide working publishers.
            }
            if (!Array.isArray(response.data?.jobs)) throw fail('JSearch returned an unrecognized job list.');
            const rows = response.data.jobs;
            entry = { jobs: rows.map(normalizeJSearch).filter(Boolean), scanned: rows.length, cursor: typeof response.data.cursor === 'string' ? response.data.cursor : '', expiresAt: now() + TTL };
            if (current !== revision || combined.aborted) break;
            if (pageCache.size >= 300) pageCache.delete(pageCache.keys().next().value);
            pageCache.set(cacheKey, entry);
          }
          pages++; scanned += entry.scanned; queries.add(item.query); jobs.push(...entry.jobs);
          if (!combined.aborted) onBatch?.(entry.jobs);
          if (entry.cursor && !item.seen.has(entry.cursor)) { item.seen.add(entry.cursor); queue.push({ ...item, cursor: entry.cursor }); }
          else if (entry.cursor) truncated = true;
          onProgress?.({ source: 'JSearch', query: item.query, pages, scanned, requestsUsed, requestLimit });
        }
        truncated ||= queue.length > 0;
        if (errors.length) error = [...new Set(errors)].join(' ');
        if (combined.aborted) { truncated = true; error = 'JSearch reached its time limit or was cancelled. Available results are retained.'; }
      } catch (cause) { error = cause.status ? cause.message : 'JSearch could not finish. Available results are retained.'; }
      finally { if (active === controller) active = null; }
      const unique = deduplicateJobs(jobs);
      const result = { jobs: unique, source: { ...SOURCE, count: unique.length, pages, scanned, queries: [...queries], queryCount: queries.size, requestsUsed, requestLimit,
        error, partial: !!error && unique.length > 0, truncated, origins: [...new Set(unique.map(job => job.origin))],
        fetchedAt: new Date(now()).toISOString(), nextCheckAt: new Date(now() + TTL).toISOString() } };
      if (!error && !combined.aborted && current === revision) { if (resultCache.size >= 30) resultCache.delete(resultCache.keys().next().value); resultCache.set(resultKey, { result, expiresAt: now() + TTL }); }
      return result;
    },
  };
}
