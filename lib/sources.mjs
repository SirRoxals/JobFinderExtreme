import { plainText, decodeEntities, safeUrl, isoDate, isSoftwareJob, inferExperience, inferWorkplace, salaryData, parseSalary, deduplicateJobs, extractExperienceRequirement, isUSRemoteJob, isUSLocation } from './jobs.mjs';

const HOUR = 3600000;

export function normalize(raw, source, fields) {
  const title = plainText(fields.title);
  const applyUrl = safeUrl(fields.applyUrl);
  if (!title || !applyUrl || !isSoftwareJob(title)) return null;
  const expiry = isoDate(fields.expiry);
  if (expiry && Date.parse(expiry) < Date.now()) return null;
  const description = plainText(fields.description);
  const providerId = source.providerId || source.id;
  return {
    id: `${providerId}:${raw.id ?? raw.guid ?? applyUrl}`,
    sourceId: providerId, sourceName: source.name, sourceUrl: source.url,
    title, company: plainText(fields.company) || 'Company not supplied',
    location: plainText(fields.location) || 'Location not supplied',
    workplace: inferWorkplace(`${fields.location || ''} ${title}`, fields.workplace, description),
    experience: inferExperience(title, fields.experience),
    experienceInferred: !fields.experience,
    requiredExperience: extractExperienceRequirement(description),
    employmentType: plainText(fields.employmentType || '').replace(/_/g, ' '),
    postedAt: isoDate(fields.postedAt), updatedAt: isoDate(fields.updatedAt),
    postedDateLabel: fields.postedDateLabel || 'Posted',
    salary: fields.salary || salaryData(), description,
    applyUrl, listingUrl: safeUrl(fields.listingUrl) || applyUrl,
  };
}

export function normalizeFreehire(raw, source) {
  if (raw.closed_at || raw.work_mode !== 'remote') return null;
  // Structured job-country eligibility is distinct from the company's headquarters.
  const countries = (Array.isArray(raw.countries) ? raw.countries : []).map(country => String(country).toUpperCase());
  if (!countries.includes('US')) return null;
  // Some indexes expand country tags from prose about company offices. A
  // foreign-only posting location must not become American by appending a tag.
  const foreign = /\b(?:Canada|United Kingdom|India|Germany|Pakistan|Philippines|Toronto|Ontario|London|Australia|Singapore|Netherlands)\b/i.test(raw.location || '');
  const usProse = /\b(?:remote (?:in|within|across)|(?:based|located|reside|residency|eligible|eligibility) (?:in|within)|(?:work|job|candidate) location\s*:)\s*(?:the\s+)?(?:United States|U\.?S\.?A?\.?)\b/i.test(plainText(raw.description));
  if (foreign && !isUSLocation(raw.location) && !usProse) return null;
  const job = normalize({ ...raw, id: raw.public_slug }, source, {
    title: raw.title, company: raw.company,
    location: [...new Set([raw.location, 'United States'].filter(Boolean))].join(' · '),
    workplace: raw.work_mode, experience: raw.enrichment?.seniority,
    description: raw.description, postedAt: raw.posted_at, updatedAt: raw.updated_at,
    postedDateLabel: 'Source posted', employmentType: raw.enrichment?.employment_type,
    salary: salaryData(raw.enrichment?.salary_min, raw.enrichment?.salary_max, raw.enrichment?.salary_currency, raw.enrichment?.salary_period),
    applyUrl: raw.url, listingUrl: `https://freehire.me/jobs/${encodeURIComponent(raw.public_slug)}`,
  });
  if (!job) return null;
  job.origin = plainText(raw.source || 'Company careers');
  job.sourceName = `Freehire · ${job.origin}`;
  job.dateCaution = raw.reality?.fake_freshness ? 'The index flags this as a possible repost. The source date may have been refreshed.' : '';
  return job;
}

export function normalizeRemotive(raw, source) {
  return normalize(raw, source, {
    title: raw.title, company: raw.company_name, location: raw.candidate_required_location,
    workplace: 'remote', employmentType: raw.job_type, postedAt: raw.publication_date,
    salary: parseSalary(raw.salary), description: raw.description, applyUrl: raw.url,
  });
}

export function normalizeJobicy(raw, source) {
  return normalize(raw, source, {
    title: raw.jobTitle, company: raw.companyName, location: raw.jobGeo,
    workplace: 'remote', experience: raw.jobLevel, employmentType: raw.jobType?.join(', '),
    postedAt: raw.pubDate, salary: salaryData(raw.salaryMin, raw.salaryMax, raw.salaryCurrency, raw.salaryPeriod),
    description: raw.jobDescription || raw.jobExcerpt, applyUrl: raw.url,
  });
}

export function normalizeHimalayas(raw, source) {
  return normalize(raw, source, {
    title: raw.title, company: raw.companyName,
    location: raw.locationRestrictions?.length ? raw.locationRestrictions.map(location => typeof location === 'string' ? location : location.name || (location.alpha2 === 'US' ? 'United States' : location.alpha2)).filter(Boolean).join(', ') : 'Worldwide',
    workplace: 'remote', experience: raw.seniority?.join(' '), employmentType: raw.employmentType,
    postedAt: raw.pubDate, expiry: raw.expiryDate,
    salary: salaryData(raw.minSalary, raw.maxSalary, raw.currency, raw.salaryPeriod),
    description: raw.description, applyUrl: raw.applicationLink, listingUrl: raw.guid,
  });
}

export function normalizeWorkable(raw, source) {
  if (raw.state && raw.state !== 'published') return null;
  return normalize(raw, source, {
    title: raw.title, company: raw.company?.title,
    location: [...new Set([...(raw.locations || []).filter(location => location !== 'TELECOMMUTE'), raw.location?.city, raw.location?.subregion, raw.location?.countryName].filter(Boolean))].join(' · '),
    workplace: raw.workplace, employmentType: raw.employmentType,
    description: [raw.description, raw.requirementsSection, raw.benefitsSection].filter(Boolean).join('\n\n'),
    postedAt: raw.created, updatedAt: raw.updated,
    salary: salaryData(), applyUrl: raw.url, listingUrl: raw.url,
  });
}

export function normalizeNomads(raw, source) {
  return normalize(raw, source, {
    title: raw.title, company: raw.company_name, location: raw.location,
    workplace: 'remote', description: raw.description, postedAt: raw.pub_date,
    salary: salaryData(), applyUrl: raw.url,
  });
}

export function normalizeGreenhouse(raw, source) {
  const postedLocations = raw.metadata?.filter((item) => /posting location/i.test(item.name)).flatMap((item) => Array.isArray(item.value) ? item.value : [item.value]).filter(Boolean) || [];
  const location = [...new Set([raw.location?.name, ...postedLocations, ...(raw.offices || []).map((office) => office.location)].filter(Boolean))].join(' · ');
  const range = raw.pay_input_ranges?.find((item) => item.currency_type === 'USD') ?? raw.pay_input_ranges?.[0];
  const salary = range ? salaryData(range.min_cents / 100, range.max_cents / 100, range.currency_type,
    /year|annual/i.test(range.title) ? 'year' : /hour/i.test(range.title) ? 'hour' : /month/i.test(range.title) ? 'month' : null) : salaryData();
  return normalize(raw, source, {
    title: raw.title, company: raw.company_name || source.company, location,
    workplace: inferWorkplace(raw.location?.name),
    // updated_at is not a posting date. Never make an old opening look newly posted.
    postedAt: raw.first_published, updatedAt: raw.updated_at, expiry: raw.application_deadline,
    salary, description: raw.content, applyUrl: raw.absolute_url,
  });
}

export function normalizeRemoteOK(raw, source) {
  if (!raw.id) return null; // The first array item contains feed terms, not a job.
  return normalize(raw, source, {
    title: raw.position, company: raw.company, location: raw.location,
    workplace: 'remote', description: raw.description, postedAt: raw.date || raw.epoch,
    // The feed does not identify salary currency/period: display without guessing.
    salary: salaryData(raw.salary_min, raw.salary_max), applyUrl: raw.url, listingUrl: raw.url,
  });
}

export function parseRSS(xml) {
  const field = (item, tag) => {
    const value = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '';
    return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
  };
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, item]) => ({
    title: field(item, 'title'), url: field(item, 'link'), description: field(item, 'description'),
    region: field(item, 'region'), postedAt: field(item, 'pubDate'), id: field(item, 'guid') || field(item, 'link'),
  }));
}

export function normalizeWWR(raw, source) {
  const split = raw.title.indexOf(':');
  const description = plainText(raw.description);
  const explicitLocation = description.match(/(?:^|\n)\s*(?:job\s+)?location\s*:\s*([^\n]+)/i)?.[1];
  const regionIsBroad = !raw.region || /anywhere|world|global/i.test(raw.region);
  return normalize(raw, source, {
    title: split >= 0 ? raw.title.slice(split + 1).trim() : raw.title,
    company: split >= 0 ? raw.title.slice(0, split) : '',
    location: regionIsBroad && explicitLocation ? explicitLocation : raw.region,
    workplace: 'remote', description, postedAt: raw.postedAt, applyUrl: raw.url,
  });
}

export function normalizeLever(raw, source) {
  const locations = [...new Set([raw.categories?.location, ...(raw.categories?.allLocations || []), raw.country?.toUpperCase() === 'US' ? 'United States' : ''].filter(Boolean))];
  return normalize(raw, source, {
    title: raw.text, company: source.company, location: locations.join(' · '), workplace: raw.workplaceType,
    employmentType: raw.categories?.commitment, description: [raw.descriptionPlain || raw.description, ...(raw.lists || []).map(list => `${list.text}\n${list.content}`), raw.additionalPlain || raw.additional].filter(Boolean).join('\n\n'),
    postedAt: raw.createdAt, postedDateLabel: 'Created',
    salary: salaryData(raw.salaryRange?.min, raw.salaryRange?.max, raw.salaryRange?.currency, raw.salaryRange?.interval),
    applyUrl: raw.applyUrl || raw.hostedUrl, listingUrl: raw.hostedUrl,
  });
}

export function normalizeAshby(raw, source) {
  if (raw.isListed === false) return null;
  const address = raw.address?.postalAddress;
  const locations = [...new Set([raw.location, address?.addressLocality, address?.addressRegion, address?.addressCountry,
    ...(raw.secondaryLocations || []).flatMap(item => [item.location, item.address?.addressCountry])].filter(Boolean))];
  const components = raw.compensation?.summaryComponents || raw.compensation?.compensationTiers?.flatMap(tier => tier.components || []) || [];
  const salary = components.find(item => item.compensationType === 'Salary' && item.currencyCode === 'USD') || components.find(item => item.compensationType === 'Salary');
  return normalize(raw, source, {
    title: raw.title, company: source.company, location: locations.join(' · '),
    workplace: raw.workplaceType || (raw.isRemote ? 'remote' : 'unknown'), employmentType: raw.employmentType,
    description: raw.descriptionPlain || raw.descriptionHtml,
    postedAt: raw.publishedAt, postedDateLabel: 'Last published',
    salary: salary ? salaryData(salary.minValue, salary.maxValue, salary.currencyCode, salary.interval === '1 YEAR' ? 'year' : salary.interval === '1 HOUR' ? 'hour' : salary.interval === '1 MONTH' ? 'month' : null) : salaryData(),
    applyUrl: raw.applyUrl || raw.jobUrl, listingUrl: raw.jobUrl,
  });
}

export function createSources(config) {
  const sources = [];
  if (config.sources.remotive) sources.push({
    id: 'remotive', name: 'Remotive', url: 'https://remotive.com', ttl: 6 * HOUR,
    endpoint: 'https://remotive.com/api/remote-jobs?category=software-dev', normalize: normalizeRemotive,
    note: 'Remote jobs. The public feed delays listings by 24 hours. Checked at most every 6 hours.',
  });
  if (config.sources.jobicy) sources.push({
    id: 'jobicy', name: 'Jobicy', url: 'https://jobicy.com', ttl: HOUR,
    endpoint: 'https://jobicy.com/api/v2/remote-jobs?count=200&industry=engineering', normalize: normalizeJobicy,
    pagination: 'cursor', note: 'Remote jobs from the past 7 days, with a 3-hour source delay. Checked hourly.',
  });
  if (config.sources.himalayas) sources.push({
    id: 'himalayas', name: 'Himalayas', url: 'https://himalayas.app', ttl: 24 * HOUR,
    endpoint: 'https://himalayas.app/jobs/api/search?q=software&sort=recent', normalize: normalizeHimalayas,
    pagination: 'page', note: 'Recent software roles. The upstream feed refreshes every 24 hours.',
  });
  if (config.sources.remoteok) sources.push({
    id: 'remoteok', name: 'Remote OK', url: 'https://remoteok.com', ttl: HOUR,
    endpoint: 'https://remoteok.com/api', format: 'array', normalize: normalizeRemoteOK,
    note: 'Recent public remote listings. Only explicit US locations pass the local filter. Checked hourly.',
  });
  if (config.sources.weworkremotely) sources.push({
    id: 'weworkremotely', name: 'We Work Remotely', url: 'https://weworkremotely.com', ttl: HOUR,
    endpoint: 'https://weworkremotely.com/categories/remote-programming-jobs.rss', format: 'rss', normalize: normalizeWWR,
    note: 'Public programming RSS feed. US eligibility comes from the region or an explicit job location, never company headquarters. Checked hourly.',
  });
  return sources;
}

export function createJobService(config, { fetchImpl = fetch, now = () => Date.now(), cache = new Map(), inFlight = new Map(), pageCache = new Map() } = {}) {
  const sources = config.searchSources || createSources(config);

  async function load(source) {
    const maxPages = source.maxPages || config.maxPages;
    const cacheKey = `${source.endpoint}|${maxPages}`;
    const previous = cache.get(cacheKey);
    if (previous && now() < previous.nextCheckAt) return previous;
    if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
    const pending = (async () => {
      const jobs = [];
      let pages = 0, scanned = 0, available = null;
      const origins = new Set();
      let truncated = false;
      let next = source.endpoint;
      let error = null;
      const deadline = AbortSignal.timeout(source.budgetMs || config.requestTimeoutMs * 2);
      try {
        while (next && pages < maxPages) {
          const cachedPage = pageCache.get(next);
          let data;
          if (cachedPage && now() < cachedPage.expiresAt) data = cachedPage.data;
          else {
            const response = await fetchImpl(next, {
            headers: { Accept: source.format === 'rss' ? 'application/rss+xml, application/xml, text/xml' : 'application/json', 'User-Agent': 'JobFinderExtreme/1.0 (local job finder)' },
            signal: AbortSignal.any([deadline, AbortSignal.timeout(config.requestTimeoutMs)]),
          });
          if (!response.ok) throw new Error(response.status === 429 ? 'Rate limited by the source. Try again later.' : `Source returned HTTP ${response.status}.`);
          if (source.format === 'rss') {
            const xml = await response.text();
            if (!/<rss\b/i.test(xml)) throw new Error('The source returned an unexpected RSS response.');
            data = { jobs: parseRSS(xml) };
          } else data = await response.json();
            if (pageCache.size >= 350) pageCache.delete(pageCache.keys().next().value);
            pageCache.set(next, { data, expiresAt: now() + source.ttl });
          }
          const body = source.format === 'catalog' ? { jobs: data.data, totalCount: data.meta?.total, ignored: data.meta?.ignored_params }
            : source.format === 'array' && Array.isArray(data) ? { jobs: data } : data;
          if (body.ignored?.length) throw new Error('The index no longer supports one of the requested search filters.');
          if (body.success === false || !Array.isArray(body.jobs)) throw new Error('The source returned an unexpected response.');
          if (Number.isFinite(body.totalCount)) available = body.totalCount;
          scanned += body.jobs.length;
          const batch = [];
          for (const raw of body.jobs) {
            if (!raw || typeof raw !== 'object') continue;
            if (typeof raw.source === 'string') origins.add(raw.source);
            const job = source.normalize(raw, source);
            if (job) { jobs.push(job); if (isUSRemoteJob(job)) batch.push(job); }
          }
          pages++;
          config.onProgress?.({ source: source.name, query: source.query || '', pages, count: jobs.filter(isUSRemoteJob).length, scanned, available });
          if (batch.length) config.onBatch?.(batch);
          next = null;
          if (source.pagination === 'cursor' && body.nextCursor) {
            const url = new URL(source.endpoint);
            url.searchParams.set('cursor', body.nextCursor);
            next = url.href;
          } else if (source.pagination === 'token' && body.nextPageToken) {
            const url = new URL(source.endpoint);
            url.searchParams.set('pageToken', body.nextPageToken); next = url.href;
          } else if (source.pagination === 'catalog' && body.jobs.length && scanned < body.totalCount && scanned < 10000) {
            const url = new URL(source.endpoint);
            url.searchParams.set('offset', String(scanned)); next = url.href;
          } else if (source.pagination === 'offset' && body.jobs.length === 100) {
            const url = new URL(source.endpoint);
            url.searchParams.set('skip', String(pages * 100)); next = url.href;
          } else if (source.pagination === 'page' && body.jobs.length && (body.totalCount === undefined ? body.jobs.length >= (body.limit || 20) : (body.offset ?? (pages - 1) * (body.limit || 20)) + body.jobs.length < body.totalCount)) {
            const url = new URL(source.endpoint);
            url.searchParams.set('page', String(pages + 1));
            next = url.href;
          }
        }
        truncated = !!next || (available !== null && scanned < available);
      } catch (cause) {
        error = cause.name === 'TimeoutError' || cause.name === 'AbortError' ? 'The source timed out.'
          : cause.message === 'fetch failed' ? 'Could not connect to the source.' : cause.message;
      }
      const checkedAt = now();
      const entry = {
        jobs: error && previous ? previous.jobs : deduplicateJobs(jobs),
        fetchedAt: error && previous ? previous.fetchedAt : jobs.length || !error ? new Date(checkedAt).toISOString() : null,
        nextCheckAt: checkedAt + (error ? 60000 : source.ttl),
        error, stale: !!error && !!previous, partial: !!error && !previous && jobs.length > 0,
        truncated: error && previous ? previous.truncated : truncated, pages, scanned, available, origins: [...origins],
      };
      if (cache.size >= 60) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, entry);
      return entry;
    })();
    inFlight.set(cacheKey, pending);
    try { return await pending; } finally { inFlight.delete(cacheKey); }
  }

  return {
    async getJobs() {
      const results = new Array(sources.length);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(config.maxConcurrent || 6, sources.length) }, async () => {
        while (cursor < sources.length) {
          const index = cursor++, source = sources[index];
          if (config.signal?.aborted) { results[index] = { source, entry: { jobs: [], error: 'Search cancelled.', nextCheckAt: now(), truncated: true, pages: 0 } }; continue; }
          results[index] = { source, entry: await load(source) };
          // Also publishes cached/shared loads to this particular search stream.
          if (results[index].entry.jobs.length) config.onBatch?.(results[index].entry.jobs.filter(isUSRemoteJob));
          config.onProgress?.({ source: source.name, completed: results.filter(Boolean).length, total: sources.length });
        }
      }));
      return {
        checkedAt: new Date(now()).toISOString(),
        jobs: deduplicateJobs(results.flatMap(({ entry }) => entry.jobs)).filter(isUSRemoteJob),
        sources: results.map(({ source, entry }) => ({
          id: source.providerId || source.id, name: source.name, url: source.url, note: source.note, group: source.group || 'Public search indexes', query: source.query || '', pages: entry.pages, scanned: entry.scanned || 0, available: entry.available, origins: entry.origins || [],
          count: entry.jobs.filter(isUSRemoteJob).length, fetchedAt: entry.fetchedAt, nextCheckAt: new Date(entry.nextCheckAt).toISOString(),
          error: entry.error, stale: entry.stale, partial: entry.partial, truncated: entry.truncated,
        })),
      };
    },
  };
}
