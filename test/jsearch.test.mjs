import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createJSearchService, normalizeJSearch, jsearchLocation, jsearchQueries, jsearchDateWindow } from '../lib/jsearch.mjs';
import { createLocalServer } from '../server.mjs';
import { filterJobs } from '../lib/jobs.mjs';
import { createSearchService } from '../lib/discovery.mjs';

const KEY = 'test-key-placeholder-not-a-real-credential';
const now = Date.parse('2026-10-16T12:00:00Z');
const rawJob = (id = 'one') => ({ job_id: id, job_title: 'Software Engineer', employer_name: 'Example', job_location: 'Remote, United States', job_country: 'US', job_is_remote: true,
  job_description: 'Develop Java services. Three years of software development experience required.', job_apply_link: `https://jobs.example.com/${id}`, job_publisher: 'Example careers', job_posted_at_datetime_utc: '2026-10-16T08:15:00Z' });
const response = data => ({ ok: true, json: async () => ({ status: 'OK', data }) });
const allowance = remaining => response({ plan: { nickname: 'Free' }, status: remaining ? 'active' : 'exceeded', quotas: [{ name: 'Requests', limit: 200, used: 200 - remaining, remaining, reset_at: '2026-11-16T00:00:00Z' }] });

test('JSearch verifies full descriptions, US eligibility and remote work without relaxing local experience or date filters', () => {
  const job = normalizeJSearch(rawJob());
  assert.ok(job);
  assert.equal(filterJobs([job], { days: '0.5', keywords: 'Java', experienceYears: '4' }, now).length, 1);
  for (const change of [{ job_country: 'CA' }, { job_is_remote: false, job_location: 'United States' }, { work_arrangement: 'hybrid' }, { job_description: 'This role is a hybrid position. Develop Java services.' }, { job_title: 'Engineering Manager' }, { job_title: 'Salesforce Developer III' }, { job_description: '' }, { job_apply_link: 'javascript:alert(1)' }]) assert.equal(normalizeJSearch({ ...rawJob(), ...change }), null);
  const senior = normalizeJSearch({ ...rawJob(), job_title: 'Senior Software Engineer' });
  assert.equal(filterJobs([senior], { experienceYears: '4', includeUnknownExperience: true }, now).length, 0);
  assert.equal(filterJobs([{ ...job, postedAt: '2026-10-15T23:59:59Z' }], { days: '0.5' }, now).length, 0);
  assert.equal(filterJobs([{ ...job, postedAt: null }], { days: '1' }, now).length, 0);
  const pay = normalizeJSearch({ ...rawJob(), job_min_salary: 90000, job_max_salary: 140000, job_salary_period: 'YEAR' });
  assert.equal(pay.salary.currency, null); // No invented currency for comparability.
});

test('JSearch queries include US and skills; upstream date buckets preserve strict local 12-hour filtering', () => {
  assert.ok(jsearchQueries({ keywords: 'Java, AWS' }).every(query => query.includes('United States') && /Java|AWS/.test(query)));
  assert.equal(jsearchQueries({ role: 'Application Developer', keywords: 'Java' })[0], 'Java Application Developer remote jobs in United States');
  assert.ok(jsearchQueries({ keywords: 'Java' }).some(query => query.endsWith('via LinkedIn')));
  assert.equal(jsearchDateWindow('0.5'), 'today');
  assert.equal(jsearchDateWindow('1'), 'today');
  assert.equal(jsearchDateWindow('14'), 'month');
  assert.equal(jsearchDateWindow('custom'), 'all');
});

test('JSearch is opt-in, paginates opaque cursors across queries, enforces a cap, and reuses results without credits', async () => {
  const calls = [], batches = [];
  const service = createJSearchService({ now: () => now, fetchImpl: async (input, options) => {
    const url = new URL(input); calls.push(url);
    assert.equal(options.headers['x-api-key'], KEY);
    assert.equal(url.href.includes(KEY), false);
    assert.equal(options.redirect, 'error');
    if (url.pathname === '/usage') return allowance(200);
    assert.equal(url.pathname, '/jsearch/search-v2');
    assert.equal(url.searchParams.get('country'), 'us');
    assert.equal(url.searchParams.get('work_from_home'), 'true');
    assert.equal(url.searchParams.get('date_posted'), 'today');
    assert.equal(url.searchParams.get('num_pages'), '1');
    const id = `${url.searchParams.get('query')}-${url.searchParams.get('cursor') || 'first'}`;
    return response({ jobs: [rawJob(id)], cursor: url.searchParams.has('cursor') ? null : 'opaque next cursor/==' });
  } });
  assert.equal((await service.getJobs({ jsearch: '1' })).source, null);
  await service.connect(KEY, 5);
  await service.getJobs({ keywords: 'Java', days: '1' });
  assert.equal(calls.length, 1); // Only the connection's usage check.
  const result = await service.getJobs({ jsearch: '1', keywords: 'Java', days: '1' }, { onBatch: batch => batches.push(...batch) });
  assert.equal(result.source.requestsUsed, 5);
  assert.equal(result.source.pages, 5);
  assert.equal(result.source.truncated, true);
  assert.equal(batches.length, 5);
  assert.equal(service.status().quota.remaining, 195);
  const before = calls.length;
  const cached = await service.getJobs({ jsearch: '1', keywords: 'Java', days: '0.5' });
  assert.equal(cached.source.requestsUsed, 0);
  assert.equal(cached.source.cacheHit, true);
  assert.equal(calls.length, before);
  assert.equal(JSON.stringify([service.status(), result, cached]).includes(KEY), false);
  service.setRequestLimit(8);
  const deeper = await service.getJobs({ jsearch: '1', keywords: 'Java', days: '1' });
  assert.equal(deeper.source.pages, 8);
  assert.equal(deeper.source.requestsUsed, 3); // The first five pages were cached.
  service.setRequestLimit(20);
  await service.getJobs({ jsearch: '1', keywords: 'Java', days: '1' });
  assert.ok(calls.some(url => url.searchParams.get('cursor') === 'opaque next cursor/=='));
  service.disconnect();
  assert.equal(service.status().connected, false);
  assert.equal(service.status().quota, null);
  assert.equal((await service.getJobs({ jsearch: '1' })).source, null);
});

test('Anywhere results need explicit job-location or residency evidence; company headquarters and the US query prove nothing', () => {
  const anywhere = { ...rawJob(), job_country: null, job_location: 'Anywhere' };
  assert.equal(normalizeJSearch(anywhere), null);
  assert.equal(normalizeJSearch({ ...anywhere, job_description: 'We are headquartered in the United States and serve US clients. Develop Java services remotely.' }), null);
  assert.equal(jsearchLocation({ ...anywhere, job_description: 'Role Location: Remote-US\nDevelop Java services.' }), 'Remote-US');
  assert.ok(normalizeJSearch({ ...anywhere, job_description: 'Candidates must be located in the United States. Develop Java services.' }));
  assert.equal(normalizeJSearch({ ...anywhere, job_description: 'This role is available from: Europe, EMEA, Spain. Develop Java services.' }), null);
  assert.equal(normalizeJSearch({ ...rawJob(), job_location: 'Remote, India' }), null);
});

test('quota exhaustion and reflected provider errors retain good results without leaking the key', async () => {
  let searches = 0, remaining = 2;
  const service = createJSearchService({ now: () => now, fetchImpl: async input => {
    if (new URL(input).pathname === '/usage') return allowance(remaining);
    searches++;
    return searches === 2 ? { ok: false, status: 429, json: async () => ({ message: `Request header: ${KEY}` }) } : response({ jobs: [rawJob()], cursor: 'more' });
  } });
  await service.connect(KEY, 20);
  const result = await service.getJobs({ jsearch: '1', keywords: 'Java' });
  assert.equal(searches, 2);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.source.partial, true);
  assert.match(result.source.error, /quota or rate limit/);
  assert.equal(JSON.stringify(result).includes(KEY), false);
  remaining = 0;
  await service.getJobs({ jsearch: '1', keywords: 'Python' });
  assert.equal(searches, 2);
  await assert.rejects(service.connect('bad', 10), /valid API key/);
});

test('concurrent searches and disconnects cannot trigger overlapping credit consumption', async () => {
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const service = createJSearchService({ fetchImpl: async (input, options) => {
    if (new URL(input).pathname === '/usage') return allowance(200);
    started();
    return await new Promise((resolve, reject) => {
      release = resolve;
      options.signal.addEventListener('abort', () => reject(new Error(`must not expose ${KEY}`)), { once: true });
    });
  } });
  await service.connect(KEY, 2);
  const pending = service.getJobs({ jsearch: '1' });
  await began;
  const second = await service.getJobs({ jsearch: '1' });
  assert.match(second.source.error, /already running/);
  assert.throws(() => service.setRequestLimit(40), /current JSearch/);
  service.disconnect();
  const cancelled = await pending;
  assert.equal(service.status().quota, null);
  assert.equal(JSON.stringify(cancelled).includes(KEY), false);
  release(response({ jobs: [], cursor: null }));
});

test('a transient query failure preserves results and continues other queries within the attempt budget', async () => {
  let attempts = 0;
  const service = createJSearchService({ fetchImpl: async input => {
    if (new URL(input).pathname === '/usage') return allowance(200);
    if (++attempts === 1) throw new Error(`Network failure containing ${KEY}`);
    return response({ jobs: [rawJob('working')], cursor: null });
  } });
  await service.connect(KEY, 2);
  const result = await service.getJobs({ jsearch: '1', keywords: 'Java' });
  assert.equal(attempts, 2);
  assert.equal(result.source.requestsUsed, 2);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.source.partial, true);
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test('combined discovery streams and counts JSearch results alongside public sources', async () => {
  const connector = createJSearchService({ fetchImpl: async input => new URL(input).pathname === '/usage' ? allowance(200) : response({ jobs: [rawJob()], cursor: null }) });
  await connector.connect(KEY, 1);
  const empty = id => ({ getJobs: async () => ({ jobs: [], source: { id, name: id, queryCount: 0 } }) });
  const service = createSearchService({ jsearchService: connector, linkedinService: empty('linkedin'), indeedService: empty('indeed'), diceService: empty('dice'), builtinService: empty('builtin'), fetchImpl: async input => ({ ok: true,
    json: async () => ['remoteok.com', 'www.workingnomads.com'].includes(new URL(input).hostname) ? [] : { jobs: [], data: [], meta: { total: 0 } }, text: async () => '<rss><channel/></rss>' }) });
  const batches = [];
  const result = await service.getJobs({ days: '0.5', keywords: 'Java', jsearch: '1' }, { onBatch: batch => batches.push(...batch) });
  assert.equal(result.jobs.length, 1);
  assert.ok(batches.some(job => job.sourceId === 'jsearch'));
  assert.equal(result.sources.find(source => source.id === 'jsearch').count, 1);
  assert.equal(result.sources.find(source => source.id === 'jsearch').requestsUsed, 1);
  assert.equal(result.search.limited, true);
});

test('local connection endpoints protect mutations and credit-consuming searches, never return the key, and forget it on restart', async t => {
  const connector = createJSearchService({ fetchImpl: async () => allowance(200) });
  const server = createLocalServer({ port: 0, jsearchService: connector, service: { getJobs: async () => ({ jobs: [], sources: [] }) } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/api/jsearch/connection`;
  const body = JSON.stringify({ apiKey: KEY, requestLimit: 5 });
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body })).status, 403);
  assert.equal((await fetch(`${url}?apiKey=placeholder`)).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{invalid' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: 'x'.repeat(5000) })).status, 413);
  assert.equal((await fetch(`${base}/api/jobs?jsearch=1`)).status, 403);
  const connected = await fetch(url, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body });
  assert.equal(connected.status, 200);
  assert.equal((await connected.text()).includes(KEY), false);
  const status = await fetch(url);
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.equal((await status.json()).connected, true);
  assert.equal((await fetch(`${base}/api/jobs?jsearch=1`, { headers: { 'X-JobFinder-Search': '1', Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await fetch(`${base}/api/jobs?jsearch=1`, { headers: { 'X-JobFinder-Search': '1' } })).status, 200);
  assert.equal((await fetch(url, { method: 'DELETE', headers: { Origin: base } })).status, 200);
  assert.equal(connector.status().connected, false);
  assert.equal(createJSearchService().status().connected, false);
});
