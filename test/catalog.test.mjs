import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchService, searchPlan } from '../lib/discovery.mjs';
import { normalizeFreehire, createJobService } from '../lib/sources.mjs';
import { filterJobs, deduplicateJobs } from '../lib/jobs.mjs';
import { createLinkedInService, parseLinkedInCards, parseLinkedInPosting, classContent } from '../lib/linkedin.mjs';
import { createIndeedService, normalizeIndeed } from '../lib/indeed.mjs';

const now = Date.parse('2026-10-15T20:00:00Z');
const raw = { public_slug: 'developer-acme', title: 'Software Engineer', company: 'Example Engineering', location: 'Remote', countries: ['us'], work_mode: 'remote', source: 'ashby', url: 'https://jobs.example.com/opening', description: '<p>Build Java services using AWS.</p><p>3 years of software engineering experience required.</p>', posted_at: '2026-10-15T15:00:00Z', enrichment: { salary_min: 100000, salary_max: 150000, salary_currency: 'USD', salary_period: 'year' } };
const source = searchPlan({ days: '30' }).find(s => s.id === 'freehire');
const response = body => ({ ok: true, json: async () => body, text: async () => '<rss><channel/></rss>' });

test('broad catalogue requests US remote full descriptions and follows its whole result range', () => {
  const url = new URL(source.endpoint);
  assert.equal(url.pathname, '/api/v1/agent/jobs/search');
  assert.equal(url.searchParams.get('countries'), 'US');
  assert.equal(url.searchParams.get('work_mode'), 'remote');
  assert.equal(url.searchParams.get('posted_within_days'), '30');
  assert.equal(source.maxPages * Number(url.searchParams.get('limit')), 10000);
  assert.ok(!url.searchParams.has('experience_years_max')); // Private numeric preference stays local.
  assert.ok(!new URL(searchPlan({ keywords: 'Java, AWS' })[0].endpoint).searchParams.has('q')); // Full-text ALL/ANY checked locally.
});

test('catalogue normalizes full evidence and salary, excludes closed, non-US and non-remote jobs', () => {
  const job = normalizeFreehire(raw, source);
  assert.equal(job.requiredExperience.minYears, 3);
  assert.equal(job.salary.currency, 'USD');
  assert.equal(job.salary.max, 150000);
  assert.match(job.sourceName, /ashby/);
  assert.match(job.description, /AWS/);
  for (const change of [{ closed_at: '2026-10-10' }, { countries: ['ca'] }, { countries: [] }, { work_mode: 'hybrid' }, { title: 'Senior Software Engineering Manager' }, { title: 'Salesforce Developer III' }, { url: 'javascript:alert(1)' }]) assert.equal(normalizeFreehire({ ...raw, ...change }, source), null);
  const hybrid = normalizeFreehire({ ...raw, description: 'This position is hybrid. 2 days per week in the office.' }, source);
  assert.equal(filterJobs([hybrid], {}).length, 0);
  assert.equal(filterJobs([normalizeFreehire({ ...raw, title: 'Software Engineer (Hybrid)' }, source)], {}).length, 0);
  assert.equal(filterJobs([{ ...job, title: 'Software Engineer - On-site', workplace: 'remote' }], {}).length, 0);
  assert.equal(normalizeFreehire({ ...raw, posted_at: null }, source).postedAt, null); // Never substitute crawl/update time.
  assert.equal(normalizeFreehire({ ...raw, location: 'Toronto, Ontario, CA', countries: ['ca', 'us'] }, source), null);
  assert.equal(normalizeFreehire({ ...raw, title: 'Software Engineer / AI Code Trainer' }, source), null);
});

test('bulk discovery streams hundreds of verified roles, preserves experience filtering and caches pages', async () => {
  const calls = [], batches = [];
  const catalogue = Array.from({ length: 237 }, (_, index) => ({ ...raw, public_slug: `job-${index}`, company: `Employer ${index}`, url: `https://jobs.example.com/${index}`, title: index % 10 === 0 ? 'Engineering Manager' : 'Software Engineer' }));
  const service = createSearchService({ now: () => now, indeedService: { getJobs: async () => ({ jobs: [], source: { id: 'indeed', name: 'Indeed', queryCount: 0 } }) }, linkedinService: { getJobs: async () => ({ jobs: [], source: { id: 'linkedin', name: 'LinkedIn', error: 'HTTP 429', count: 0 } }) }, fetchImpl: async input => {
    const url = new URL(input); calls.push(url.href);
    if (url.hostname === 'freehire.me') {
      const offset = Number(url.searchParams.get('offset') || 0);
      return response({ data: catalogue.slice(offset, offset + 100), meta: { total: catalogue.length, offset } });
    }
    if (['remoteok.com', 'www.workingnomads.com'].includes(url.hostname)) return response([]);
    return response({ jobs: [], totalCount: 0 });
  } });
  const result = await service.getJobs({ days: '30' }, { onBatch: batch => batches.push(batch) });
  assert.equal(result.jobs.length, 213);
  assert.equal(filterJobs(result.jobs, { experienceYears: '4', days: '1', keywords: 'Java, AWS', includeUnknownExperience: false }, now).length, 213);
  assert.equal(result.sources.find(s => s.id === 'freehire').pages, 3);
  assert.equal(result.sources.find(s => s.id === 'freehire').scanned, 237);
  assert.equal(result.search.companies, 213);
  assert.deepEqual(result.search.origins, ['ashby']);
  assert.equal(batches.flat().length, 213); // Cached completion does not duplicate streamed jobs.
  assert.ok(result.sources.find(s => s.id === 'linkedin').error);
  assert.equal(result.search.limited, false);
  const before = calls.length;
  const cached = await service.getJobs({ days: '30' });
  assert.equal(calls.length, before);
  assert.equal(cached.jobs.length, 213);
});

test('catalogue failures preserve earlier pages and unsupported filters fail visibly', async () => {
  let count = 0;
  const run = fetchImpl => createJobService({ searchSources: [source], maxPages: 100, maxConcurrent: 1, requestTimeoutMs: 1000 }, { now: () => now, fetchImpl }).getJobs();
  const partial = await run(async () => ++count === 1 ? response({ data: [raw], meta: { total: 200 } }) : { ok: false, status: 429 });
  assert.equal(partial.jobs.length, 1);
  assert.equal(partial.sources[0].partial, true);
  assert.match(partial.sources[0].error, /Rate limited/);
  const ignored = await run(async () => response({ data: [raw], meta: { total: 1, ignored_params: ['work_mode'] } }));
  assert.equal(ignored.jobs.length, 0);
  assert.match(ignored.sources[0].error, /no longer supports/);
});

test('syndicated application URLs dedupe across tracking parameters and city variants', () => {
  const job = normalizeFreehire(raw, source);
  const duplicate = { ...job, id: 'another-index:1', location: 'Austin, TX', applyUrl: `${raw.url}?utm_source=another&source=feed` };
  assert.equal(deduplicateJobs([job, duplicate]).length, 1);
  assert.equal(deduplicateJobs([job, { ...duplicate, applyUrl: 'https://jobs.example.com/different-opening' }]).length, 2);
});

const cardHtml = '<li><div data-entity-urn="urn:li:jobPosting:123"><h3 class="base-search-card__title">Software Engineer</h3><h4 class="base-search-card__subtitle"><a>Example &amp; Co</a></h4><span class="job-search-card__location">United States</span><time datetime="2026-10-15"></time></div></li>';
const card = parseLinkedInCards(cardHtml)[0];
const posting = description => `<div class="show-more-less-html__markup"><div>${description}</div><p>3 years of software engineering experience required.</p></div>`;

test('LinkedIn cards and nested full descriptions are parsed without trusting the search remote flag', () => {
  assert.equal(card.company, 'Example & Co');
  assert.match(classContent(posting('Fully remote.'), 'show-more-less-html__markup'), /3 years/);
  assert.equal(parseLinkedInPosting(posting('Build Java services.'), card, now), null);
  assert.equal(parseLinkedInPosting(posting('This role is hybrid.'), card, now), null);
  const job = parseLinkedInPosting(posting('This role is fully remote. Build Java services.'), card, now);
  assert.equal(job.requiredExperience.minYears, 3);
  assert.equal(parseLinkedInPosting(posting('Fully remote.'), { ...card, location: 'London, United Kingdom' }, now), null);
  assert.equal(parseLinkedInPosting('<h1>Sign in</h1>', card, now), null);
});

test('LinkedIn schema data confirms remote work and rejects expired or contradictory office schedules', () => {
  const schema = { '@type': 'JobPosting', title: 'Software Engineer', jobLocationType: 'TELECOMMUTE', description: 'Build Java services. 2 years experience required.', datePosted: '2026-10-15', baseSalary: { currency: 'USD', value: { minValue: 100000, maxValue: 150000, unitText: 'YEAR' } } };
  const html = object => `<script type="application/ld+json">${JSON.stringify(object)}</script>`;
  assert.equal(parseLinkedInPosting(html(schema), card, now).salary.max, 150000);
  assert.equal(parseLinkedInPosting(html({ ...schema, validThrough: '2026-10-01' }), card, now), null);
  assert.equal(parseLinkedInPosting(html({ ...schema, description: 'This role is hybrid, 3 days per week in the office.' }), card, now), null);
});

test('LinkedIn blocks stop the crawl, retain good jobs and put all queries on cooldown', async () => {
  let requests = 0;
  const service = createLinkedInService({ now: () => now, delayMs: 0, fetchImpl: async () => ++requests === 1 ? { ok: true, text: async () => cardHtml.replace('</li>', '</li>' + cardHtml.replaceAll('123', '456')) } : requests === 2 ? { ok: true, text: async () => posting('This role is fully remote.') } : { ok: false, status: 429 } });
  const result = await service.getJobs({ role: 'software' });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.source.partial, true);
  assert.match(result.source.error, /rate limited/);
  await service.getJobs({ role: 'backend' });
  assert.equal(requests, 3); // No automatic retries, evasion, or extra queries after blocking.
});

const indeedRaw = { id: 'in-123', title: 'Software Engineer', company: 'Example Engineering', location: 'United States', description: '<p>Work Location: Remote</p><p>3+ years software engineering experience.</p>', jobUrl: 'https://www.indeed.com/viewjob?jk=123', datePosted: '2026-10-15', isRemote: true, minAmount: 100000, maxAmount: 150000, currency: 'USD', interval: 'yearly' };

test('Indeed requires explicit posting evidence and preserves full descriptions, dates and salary', () => {
  const job = normalizeIndeed(indeedRaw);
  assert.equal(job.requiredExperience.minYears, 3);
  assert.equal(job.salary.max, 150000);
  assert.equal(normalizeIndeed({ ...indeedRaw, description: 'Maintain remote servers. Work with remote colleagues.' }), null);
  assert.equal(normalizeIndeed({ ...indeedRaw, description: 'This role is hybrid. Work Location: Remote' }), null);
  assert.equal(normalizeIndeed({ ...indeedRaw, location: 'London, UK' }), null);
  assert.equal(normalizeIndeed({ ...indeedRaw, title: 'Engineering Manager' }), null);
});

test('Indeed date filtering never silently drops remote verification and blocked queries stop', async () => {
  const options = [];
  const service = createIndeedService({ now: () => now, scrapeImpl: async input => {
    options.push(input);
    return { jobs: [indeedRaw], meta: { sites: [{ status: 'partial', error: { message: 'HTTP 429' } }] } };
  } });
  const result = await service.getJobs({ days: '1' });
  assert.equal(result.jobs.length, 1);
  assert.match(options[0].searchTerm, /remote/);
  assert.equal(options[0].hoursOld, 24);
  assert.equal(options[0].descriptionFormat, 'html');
  assert.equal(options[0].isRemote, undefined);
  assert.equal(result.source.partial, true);
  assert.ok(result.source.error);
  assert.equal(options.length, 1);
});
