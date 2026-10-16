import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { preciseScrapeJobs, preserveIndeedEvidence } from '../lib/jobspy-client.mjs';
import { indeedQueries, normalizeIndeed } from '../lib/indeed.mjs';
import { parseDiceSearch, createDiceService, normalizeSchemaPosting } from '../lib/dice.mjs';
import { relativePostingWindow, parseBuiltinSearch, normalizeBuiltin } from '../lib/builtin.mjs';
import { filterJobs, deduplicateJobs, keywordMatches } from '../lib/jobs.mjs';
import { searchPlan } from '../lib/discovery.mjs';
import { buildBoardSearches } from '../lib/boards.mjs';

const now = Date.parse('2026-10-16T09:30:00Z');
const job = (id, postedAt) => ({ id, title: 'Software Engineer', company: 'Example', sourceId: 'example', location: 'US', workplace: 'remote', description: 'Build Java services.', postedAt, applyUrl: `https://jobs.example.com/${id}` });

test('12 hours is a rolling interval across midnight and excludes older, missing and future dates', () => {
  const jobs = [job('inside', '2026-10-15T22:00:00Z'), job('boundary', '2026-10-15T21:30:00Z'), job('outside', '2026-10-15T21:29:59Z'), job('missing', null), job('future', '2026-10-17T00:00:00Z')];
  assert.deepEqual(filterJobs(jobs, { days: '0.5' }, now).map(j => j.id), ['inside', 'boundary']);
  assert.equal(filterJobs(jobs, { days: '1' }, now).length, 3);
  const plan = searchPlan({ days: '0.5' });
  const catalog = new URL(plan[0].endpoint);
  assert.equal(catalog.searchParams.get('posted_within_days'), '1'); // Provider only accepts whole days.
  assert.equal(catalog.searchParams.has('category'), false); // Includes miscategorized software, checked locally.
  const boards = buildBoardSearches({ days: '0.5' });
  assert.equal(new URL(boards[0].url).searchParams.get('f_TPR'), 'r43200');
  assert.equal(new URL(boards[1].url).searchParams.get('fromage'), '1');
  assert.match(boards[1].note, /12h unavailable/);
});

test('different requisitions with the same title and location survive; actual copies dedupe', () => {
  const first = job('opening-1', '2026-10-16T08:00:00Z');
  const second = job('opening-2', first.postedAt);
  assert.equal(deduplicateJobs([first, second]).length, 2);
  assert.equal(deduplicateJobs([first, { ...first, applyUrl: `${first.applyUrl}?utm_source=feed` }]).length, 1);
  const description = 'Build Java APIs and distributed services. '.repeat(5);
  assert.equal(deduplicateJobs([{ ...first, description }, { ...second, description }]).length, 2);
  assert.equal(deduplicateJobs([{ ...first, description }, { ...second, description, sourceId: 'another-index' }]).length, 1);
  const a = { ...first, applyUrl: 'https://jobs.ashbyhq.com/example/uuid/application' };
  assert.equal(deduplicateJobs([a, { ...second, applyUrl: 'https://jobs.ashbyhq.com/example/uuid?utm_source=feed' }]).length, 1);
  assert.equal(deduplicateJobs([{ ...first, applyUrl: 'https://jobs.lever.co/example/uuid/apply' }, { ...second, applyUrl: 'https://jobs.lever.co/example/uuid' }]).length, 1);
});

test('Indeed skill queries are targeted without replacing broad discovery or local ALL/ANY checks', () => {
  const queries = indeedQueries({ keywords: 'Java, AWS' });
  assert.ok(queries.some(q => q === 'Java developer remote'));
  assert.ok(queries.some(q => q === 'AWS software engineer remote'));
  assert.ok(queries.includes('software engineer remote'));
  assert.deepEqual(indeedQueries({ role: 'Backend engineer', keywords: 'Java' }), ['Backend engineer Java remote', 'Backend engineer remote']);
});

test('versioned tech names match their language without admitting JavaScript as Java', () => {
  for (const text of ['Java17', 'Java8/11', 'JavaEE8']) assert.ok(keywordMatches(text, 'Java'));
  assert.ok(keywordMatches('Python3', 'Python'));
  assert.ok(keywordMatches('.NET8', '.NET'));
  for (const text of ['JavaScript', 'myJava17', 'Java17Script']) assert.equal(keywordMatches(text, 'Java'), false);
});

test('pinned Indeed adapter preserves real listing timestamps and structured workplace evidence', async () => {
  const require = createRequire(import.meta.url), axios = require('axios');
  const original = axios.defaults.adapter;
  const listed = '2026-10-15T22:12:34.567Z', published = '2026-09-01T10:00:00.000Z';
  axios.defaults.adapter = async config => {
    assert.equal(config.url, 'https://apis.indeed.com/graphql');
    assert.match(JSON.parse(config.data).query, /start: "12h"/);
    return { status: 200, statusText: 'OK', headers: {}, config, data: { data: { jobSearch: { pageInfo: { nextCursor: null }, results: [{ job: {
      key: 'fixture', title: 'Software Engineer', source: { name: 'Example' }, employer: { name: 'Example' }, datePublished: Date.parse(published), dateOnIndeed: Date.parse(listed),
      description: { html: '<p>Build Java services.</p><p>3 years of software engineering experience required.</p>' },
      location: { countryCode: 'US', city: 'Austin', admin1Code: 'TX', formatted: { long: 'Austin, TX, United States' } }, attributes: [{ key: 'DSQF7', label: 'Remote' }],
    } }] } } } };
  };
  try {
    const result = await preciseScrapeJobs({ sites: ['indeed'], searchTerm: 'Java developer remote', location: 'United States', country: 'usa', hoursOld: 12, resultsWanted: 5, descriptionFormat: 'html', verbose: 0 });
    assert.equal(result.jobs.length, 1);
    const raw = result.jobs[0];
    assert.equal(raw.datePosted, listed); // Yesterday evening must not be rounded to yesterday midnight.
    assert.equal(raw.originalPostedAt, published);
    assert.equal(raw.workplaceEvidence, 'indeed_remote');
    const normalized = normalizeIndeed(raw);
    assert.ok(normalized);
    assert.match(normalized.dateCaution, /may be a repost/);
    assert.equal(filterJobs([normalized], { days: '0.5', experienceYears: '4', keywords: 'Java' }, now).length, 1);
    assert.equal(normalizeIndeed({ ...raw, workplaceEvidence: null }), null); // Merely isRemote=true is insufficient.
  } finally { axios.defaults.adapter = original; }
  const installed = await readFile(require.resolve('ts-jobspy'), 'utf8');
  assert.match(installed, /toISOString\(\)\.split/); // Installed library is untouched.
  assert.throws(() => preserveIndeedEvidence('changed upstream bundle'), /incompatible/);
});

const schema = { '@type': 'JobPosting', identifier: { value: 'a' }, title: 'Software Engineer', description: 'Develop Java services. 3 years of software engineering experience required.', datePosted: '2026-10-16T08:00:00Z', jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { name: 'USA' }, hiringOrganization: { name: 'Example' }, url: 'https://www.dice.com/job-detail/a' };
const diceCard = id => ({ guid: id, title: 'Software Engineer', postedDate: schema.datePosted });
const flight = jobs => `<script>self.__next_f.push([1,${JSON.stringify('1:' + JSON.stringify(['$', 'component', null, { jobList: { data: jobs, meta: { totalResults: 2, pageCount: 2, searchedLocation: { countryCode2: 'US' } }, _links: { self: { href: '/v1/dice/jobs/search?q=Java' } } } }]) + '\n')}])</script>`;

test('Dice parses JSON data without executing scripts or accepting similar-job recommendations', () => {
  assert.equal(parseDiceSearch(flight([diceCard('a')])).jobs[0].guid, 'a');
  assert.throws(() => parseDiceSearch(flight([diceCard('a')]).replace('/jobs/search?', '/jobs/similar?')), /unrecognized/);
  assert.throws(() => parseDiceSearch('<script>globalThis.shouldNotExecute=true</script>'), /unrecognized/);
  assert.equal(globalThis.shouldNotExecute, undefined);
  assert.ok(normalizeSchemaPosting(schema));
  assert.equal(normalizeSchemaPosting({ ...schema, jobLocationType: 'ONSITE' }), null);
  assert.equal(normalizeSchemaPosting({ ...schema, applicantLocationRequirements: { name: 'Canada' } }), null);
  assert.equal(normalizeSchemaPosting({ ...schema, title: 'Engineering Manager' }), null);
});

test('Dice paginates full descriptions and preserves valid results when later pages fail', async () => {
  const batches = [], calls = [];
  const service = createDiceService({ now: () => now, fetchImpl: async input => {
    const url = new URL(input); calls.push(url.href);
    if (url.pathname === '/jobs') return url.searchParams.get('page') === '2' ? { ok: false, status: 429 } : { ok: true, text: async () => flight([diceCard('a')]) };
    return { ok: true, text: async () => `<script type="application/ld+json">${JSON.stringify(schema)}</script>` };
  } });
  const result = await service.getJobs({ days: '0.5', keywords: 'Java' }, { onBatch: batch => batches.push(...batch) });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.source.partial, true);
  assert.match(result.source.error, /HTTP 429/);
  assert.ok(calls.some(url => new URL(url).searchParams.get('page') === '2'));
  assert.equal(batches.length, 1);
});

test('relative posted/reposted times use a conservative range for 12h and 24h cutoffs', () => {
  const range = relativePostingWindow('Reposted 8 Hours Ago', now);
  const card = { url: 'https://builtin.com/job/example/a', window: range, arrangement: 'Remote' };
  const normalized = normalizeBuiltin(schema, card);
  assert.equal(normalized.postedAtPrecision, 'hour');
  assert.match(normalized.postedDateLabel, /Reposted/);
  assert.equal(filterJobs([normalized], { days: '0.5' }, now).length, 1);
  const boundary = normalizeBuiltin(schema, { ...card, window: relativePostingWindow('Posted 12 Hours Ago', now) });
  assert.equal(filterJobs([boundary], { days: '0.5' }, now).length, 0); // Could actually be 12h 59m old.
  assert.equal(normalizeBuiltin(schema, { ...card, arrangement: 'In-Office or Remote' }), null);
  const html = '<div data-id="job-card"><a data-id="job-card-title" href="/job/example/a">Software Engineer</a><span x-show="!showSavedTag">Reposted 8 Hours Ago</span><span>Saved</span></div>';
  assert.ok(parseBuiltinSearch(html, now)[0].window); // Adjacent "Saved" text must not swallow the time.
});
