import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { filterJobs, postingDateBounds } from '../lib/jobs.mjs';
import { buildBoardSearches } from '../lib/boards.mjs';
import { createJobService, createSources, normalizeAshby, normalizeLever, normalizeRemoteOK, normalizeWWR, parseRSS } from '../lib/sources.mjs';

const source = { id: 'example', name: 'Example board', company: 'Example', url: 'https://example.com' };
const job = (id, postedAt) => ({ id, postedAt, title: 'Software Engineer', company: 'Example', description: '', location: 'USA', workplace: 'remote', sourceId: 'example' });

test('custom date ranges include both whole local dates, exclude missing dates, and accept open bounds', () => {
  const jobs = [job('before', new Date(2026, 9, 9, 23, 59).toISOString()), job('start', new Date(2026, 9, 10).toISOString()), job('end', new Date(2026, 9, 15, 23, 59, 59, 999).toISOString()), job('after', new Date(2026, 9, 16).toISOString()), job('unknown', null)];
  assert.deepEqual(filterJobs(jobs, { days: 'custom', dateFrom: '2026-10-10', dateTo: '2026-10-15' }).map(j => j.id), ['end', 'start']);
  assert.equal(filterJobs(jobs, { days: 'custom', dateFrom: '', dateTo: '2026-10-15' }).length, 3);
  assert.equal(filterJobs(jobs, { days: 'custom', dateFrom: '2026-10-10', dateTo: '' }).length, 3);
  assert.equal(filterJobs(jobs, { days: 'custom', dateFrom: '', dateTo: '' }).length, 5);
});

test('invalid and reversed custom ranges are rejected', () => {
  for (const [from, to] of [['2026-10-16', '2026-10-15'], ['2026-02-30', ''], ['not-a-date', '2026-10-15']]) {
    assert.equal(postingDateBounds(from, to).valid, false);
    assert.deepEqual(filterJobs([job('x', '2026-10-15T00:00:00Z')], { days: 'custom', dateFrom: from, dateTo: to }), []);
  }
});

test('date boundaries follow calendar days across daylight saving changes', () => {
  const code = "import {postingDateBounds} from './lib/jobs.mjs'; const a=postingDateBounds('2026-03-08','2026-03-08');const b=postingDateBounds('2026-11-01','2026-11-01');console.log(JSON.stringify([(a.end-a.start)/3600000,(b.end-b.start)/3600000]));";
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, TZ: 'America/New_York' } });
  assert.deepEqual(JSON.parse(result), [23, 25]);
});

test('LinkedIn launcher carries query, US remote flags, sort and supported relative age', () => {
  const boards = buildBoardSearches({ keywords: 'Java, AWS', days: '3' });
  const linkedin = new URL(boards.find(board => board.name === 'LinkedIn').url);
  assert.equal(linkedin.searchParams.get('f_WT'), '2');
  assert.equal(linkedin.searchParams.get('geoId'), '103644278');
  assert.equal(linkedin.searchParams.get('f_TPR'), 'r259200');
  assert.match(linkedin.searchParams.get('keywords'), /Java AWS/);
  assert.equal(new URL(buildBoardSearches({ days: 'custom' })[0].url).searchParams.has('f_TPR'), false);
  assert.equal(boards.length, 8);
});

test('RSS safely reads CDATA, entities, dates and job regions', () => {
  const xml = '<rss><channel><item><title><![CDATA[Example: Software Engineer]]></title><link>https://example.com/job?a=1&amp;b=2</link><guid isPermaLink="true">https://example.com/job</guid><region>USA</region><pubDate>Thu, 15 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>3 years of Java experience.</p>]]></description></item></channel></rss>';
  const [raw] = parseRSS(xml), normalized = normalizeWWR(raw, source);
  assert.equal(normalized.company, 'Example');
  assert.equal(normalized.title, 'Software Engineer');
  assert.equal(normalized.requiredExperience.minYears, 3);
  assert.equal(normalized.postedAt, '2026-10-15T10:00:00.000Z');
  assert.equal(normalized.applyUrl, 'https://example.com/job?a=1&b=2');
  assert.deepEqual(parseRSS('<!DOCTYPE rss SYSTEM "https://example.com/private"><rss/>'), []);
});

test('WWR does not mistake US company headquarters for US job eligibility', () => {
  const raw = { id: '1', title: 'Example: Software Engineer', url: 'https://example.com', region: 'Anywhere in the World', description: '<p>Headquarters: United States</p><p>Build software.</p>' };
  assert.equal(filterJobs([normalizeWWR(raw, source)], {}).length, 0);
  raw.description += '<p>Location: Remote - US</p>';
  assert.equal(filterJobs([normalizeWWR(raw, source)], {}).length, 1);
});

test('Ashby honors listing visibility, explicit location, salary and last-published date', () => {
  const raw = { id: '1', title: 'Software Engineer', location: 'Remote', workplaceType: 'Remote', isListed: true, address: { postalAddress: { addressCountry: 'United States' } }, publishedAt: '2026-10-15T00:00:00Z', descriptionPlain: '3 years of development experience.', applyUrl: 'https://example.com/apply', compensation: { summaryComponents: [{ compensationType: 'EquityPercentage', minValue: 1, maxValue: 2 }, { compensationType: 'Salary', currencyCode: 'USD', interval: '1 YEAR', minValue: 120000, maxValue: 160000 }] } };
  const normalized = normalizeAshby(raw, source);
  assert.equal(normalized.salary.min, 120000);
  assert.equal(normalized.salary.period, 'year');
  assert.equal(normalized.postedDateLabel, 'Last published');
  assert.equal(filterJobs([normalized], {}).length, 1);
  assert.equal(normalizeAshby({ ...raw, isListed: false }, source), null);
});

test('Lever keeps requirement lists, structured country/pay and actual creation dates', () => {
  const normalized = normalizeLever({ id: '1', text: 'Software Engineer', country: 'US', categories: { location: 'Remote', commitment: 'Full-time' }, workplaceType: 'remote', descriptionPlain: 'Build APIs.', lists: [{ text: 'Requirements', content: '<ul><li>5+ years of Java experience.</li></ul>' }], createdAt: 1792022400000, applyUrl: 'https://example.com/apply', salaryRange: { min: 100000, max: 150000, currency: 'USD', interval: 'year' } }, source);
  assert.equal(normalized.requiredExperience.minYears, 5);
  assert.equal(normalized.postedDateLabel, 'Created');
  assert.equal(normalized.salary.period, 'year');
  assert.equal(filterJobs([normalized], { experienceYears: '3' }).length, 0);
});

test('Remote OK metadata is not a job and its ambiguous salary is not converted', () => {
  assert.equal(normalizeRemoteOK({ legal: 'Feed terms' }, source), null);
  const normalized = normalizeRemoteOK({ id: '1', position: 'Software Engineer', company: 'Example', location: 'USA', salary_min: 100000, salary_max: 150000, date: '2026-10-15', url: 'https://remoteok.com/job' }, source);
  assert.equal(normalized.salary.currency, null);
  assert.equal(normalized.salary.period, null);
});

test('RSS challenges are reported as source failures, not empty successful feeds', async () => {
  const service = createJobService({ sources: { weworkremotely: true }, maxPages: 1, requestTimeoutMs: 1000 }, { fetchImpl: async () => ({ ok: true, text: async () => '<html>Temporarily unavailable</html>' }) });
  const data = await service.getJobs();
  assert.match(data.sources[0].error, /unexpected RSS/);
  assert.deepEqual(data.jobs, []);
});

test('feed loading bounds concurrency while preserving all source statuses', async () => {
  let active = 0, peak = 0;
  const config = { searchSources: Array.from({ length: 12 }, (_, i) => ({ id: `index${i}`, name: `Index ${i}`, endpoint: `https://example.com/index${i}`, ttl: 1000, normalize: () => null })), maxPages: 1, requestTimeoutMs: 1000, maxConcurrent: 3 };
  const service = createJobService(config, { fetchImpl: async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return { ok: true, json: async () => ({ jobs: [] }) };
  } });
  const data = await service.getJobs();
  assert.equal(data.sources.length, 12);
  assert.equal(peak, 3);
});

test('manual configuration is not required and local artifacts stay ignored', async () => {
  await assert.rejects(readFile('jobs.config.json'), { code: 'ENOENT' });
  const server = await readFile('server.mjs', 'utf8');
  assert.equal(server.includes('jobs.config.json') || server.includes('jobs.local.json'), false);
  const ignored = execFileSync('git', ['check-ignore', '--', 'jobs.local.json', '.env', 'exports/example.csv', 'software-jobs-example.csv', 'screenshots/example.png', 'example.key'], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.equal(ignored.length, 6);
});
