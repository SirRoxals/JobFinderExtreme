import test from 'node:test';
import assert from 'node:assert/strict';
import { keywordMatches, filterJobs, plainText, isSoftwareJob, isUSLocation, annualUSD, salaryData, parseSalary, deduplicateJobs, extractExperienceRequirement, isUSRemoteJob } from '../lib/jobs.mjs';
import { normalizeGreenhouse, normalizeHimalayas, createJobService } from '../lib/sources.mjs';

const now = Date.parse('2026-10-15T16:00:00Z');
const job = (overrides = {}) => ({ id: '1', title: 'Software Engineer', company: 'Example', description: 'Build APIs in Java and AWS.', location: 'United States', workplace: 'remote', experience: 'unknown', postedAt: '2026-10-15T12:00:00Z', sourceId: 'jobicy', salary: salaryData(120000, 180000, 'USD', 'yearly'), ...overrides });

test('keywords match actual words, punctuation stacks and phrases', () => {
  assert.equal(keywordMatches('JavaScript and AWS', 'Java'), false);
  assert.equal(keywordMatches('Java, AWS, Spring Boot, C++, C# and .NET.', 'Java'), true);
  for (const word of ['AWS', 'Spring Boot', 'C++', 'C#', '.NET']) assert.ok(keywordMatches('aws, Spring Boot, C++, C# and .NET.', word), word);
  assert.equal(keywordMatches('drawstring', 'AWS'), false);
  assert.equal(keywordMatches('Node.js', 'Node.js'), true);
});

test('all and any keywords search descriptions as well as titles', () => {
  const jobs = [job(), job({ id: '2', description: 'JavaScript and AWS' })];
  assert.deepEqual(filterJobs(jobs, { keywords: 'Java, AWS', keywordMode: 'all' }, now).map((item) => item.id), ['1']);
  assert.equal(filterJobs(jobs, { keywords: 'Java, AWS', keywordMode: 'any' }, now).length, 2);
});

test('US search requires an explicit US location and excludes worldwide-only eligibility', () => {
  for (const location of ['USA', 'United States', 'U.S.', 'Austin, TX', 'San Francisco', 'California', 'New York, New York, USA']) assert.ok(isUSLocation(location), location);
  for (const location of ['Worldwide', 'Anywhere', 'Global', 'North America', 'Americas', 'United Kingdom', 'Canada', 'Berlin, Germany', 'Australia', 'South America', 'Remote (Europe only)', 'Location not supplied', 'Worldwide except USA', 'Outside the United States']) assert.equal(isUSLocation(location), false, location);
  assert.equal(filterJobs([job(), job({ id: '2', location: 'Germany' })], { country: 'us' }, now).length, 1);
});

test('salary filters do not compare different currencies or hourly pay', () => {
  const jobs = [job(), job({ id: '2', salary: salaryData(150000, 200000, 'EUR', 'year') }), job({ id: '3', salary: salaryData(80, 100, 'USD', 'hour') }), job({ id: '4', salary: salaryData() })];
  assert.equal(filterJobs(jobs, { minSalary: '170000', includeUnknownSalary: false }, now).length, 1);
  assert.equal(filterJobs(jobs, { minSalary: '170000', includeUnknownSalary: true }, now).length, 4);
  assert.equal(filterJobs(jobs, { salaryOnly: true }, now).length, 1);
  assert.equal(annualUSD(parseSalary('$120,000 - $180,000')), null);
});

test('freshness uses original posting date, not updates; newest first', () => {
  const jobs = [job({ id: 'old', postedAt: '2026-08-01T00:00:00Z', updatedAt: new Date(now).toISOString() }), job({ id: 'new' }), job({ id: 'missing', postedAt: null })];
  assert.deepEqual(filterJobs(jobs, { days: '1' }, now).map((item) => item.id), ['new']);
  assert.deepEqual(filterJobs(jobs, {}, now).map((item) => item.id), ['new', 'old', 'missing']);
});

test('zero selected feeds gives zero results, and different locations survive deduplication', () => {
  assert.equal(filterJobs([job()], { sources: [] }, now).length, 0);
  assert.equal(deduplicateJobs([job(), job({ id: 'duplicate' }), job({ id: 'other', location: 'Canada' })]).length, 2);
});

test('software scope excludes other engineering disciplines and administrative jobs', () => {
  for (const title of ['Software Engineer', 'Senior Backend Developer', 'Frontend Engineer', 'Full Stack Developer', 'Mobile Engineer', 'Embedded Software Engineer', 'Java Developer']) assert.ok(isSoftwareJob(title), title);
  for (const title of ['Remote Office Assistant', 'Sales Engineer', 'Mechanical Engineer', 'Customer Support Engineer', 'Manager II, Developer Advocacy', 'Developer Advocate - Service Management', 'Staff Product Manager - Self Improving Software', 'Product Manager - Developer Experience', 'Software Account Manager', 'Senior Software Engineering Manager', 'Engineering Manager', 'Salesforce Developer III', 'Salesforce Software Engineer', 'ServiceNow Developer', 'SAP Developer', 'Staff Platform Engineer', 'Site Reliability Engineer', 'DevOps Engineer', 'QA Software Engineer', 'Software Engineering Director']) assert.equal(isSoftwareJob(title), false, title);
});

test('four years excludes senior and higher titles even if their numeric requirement is low', () => {
  const jobs = ['Software Engineer II', 'Senior Software Engineer', 'Lead Software Engineer', 'Staff Software Engineer', 'Principal Software Engineer', 'Software Engineer III', 'Software Engineer IV'].map((title, index) => job({ id: String(index), title, description: '3 years of software development experience.' }));
  assert.deepEqual(filterJobs(jobs, { experienceYears: '4', includeUnknownExperience: true }, now).map(job => job.title), ['Software Engineer II']);
  assert.equal(filterJobs(jobs, { experienceYears: '5', includeUnknownExperience: true }, now).length, 7);
});

test('old saved managers and specialist roles cannot bypass the new role gate', () => {
  assert.deepEqual(filterJobs([job({ title: 'Engineering Manager' }), job({ title: 'Salesforce Developer III' })], { includeUnknownExperience: true }, now), []);
});

test('the word developer alone does not admit non-software development professions', () => {
  for (const title of ['Business Developer', 'Content Developer', 'Curriculum Developer', 'Developer Relations Engineer', 'BI Developer', 'Power BI Developer', 'CNC Programmer']) assert.equal(isSoftwareJob(title), false, title);
});

test('experience requirements recognize numeric, spelled, ranged, and parenthesized years', () => {
  for (const [text, expected] of [
    ['At least 5+ years of professional software engineering experience.', 5],
    ['3-5 years of experience in Java.', 3],
    ['Three to five years of relevant experience.', 3],
    ['Four (4) years of programming experience.', 4],
    ['A minimum of 4.5 years of software development experience.', 4.5],
    ["2 years' experience building APIs and 5 years of professional development experience.", 5],
    ['0-2 yrs of engineering experience.', 0],
    ['Experience: 3 years', 3],
    ['3 or more years of professional experience.', 3],
    ['No prior experience is required.', 0],
  ]) assert.equal(extractExperienceRequirement(text).minYears, expected, text);
});

test('experience parser ignores preferred requirements and company history', () => {
  const text = 'We have over 20 years of experience building software.\nRequired Qualifications\n3+ years of software development experience.\nPreferred Qualifications\n8 years of management experience.\n5 years of Java experience preferred.';
  assert.equal(extractExperienceRequirement(text).minYears, 3);
  assert.equal(extractExperienceRequirement('5 years of AWS experience preferred.').minYears, null);
  assert.equal(extractExperienceRequirement('Nice to have\n5 years of AWS experience.').minYears, null);
  assert.equal(extractExperienceRequirement('25 days of annual leave and a 5-year company anniversary bonus.').minYears, null);
});

test('degree alternatives use the lower experience pathway on the same line', () => {
  for (const text of [
    "Bachelor's degree and 5 years of experience or Master's degree and 3 years of experience.",
    "Master's degree and 3 years or Bachelor's degree and 5 years of experience.",
  ]) assert.equal(extractExperienceRequirement(text).minYears, 3);
});

test('four years excludes 5+ requirements, keeps eligible ranges, and hides unknowns by default', () => {
  const jobs = [
    job({ id: 'five', description: '5+ years of software engineering experience required.' }),
    job({ id: 'four', description: '4 years of Java development experience required.' }),
    job({ id: 'range', description: '3-5 years of experience building APIs.' }),
    job({ id: 'unknown', description: 'Build software in Java and AWS.' }),
    job({ id: 'over', description: 'More than 4 years of experience building software.' }),
  ];
  assert.deepEqual(new Set(filterJobs(jobs, { experienceYears: '4' }, now).map(item => item.id)), new Set(['four', 'range']));
  assert.deepEqual(new Set(filterJobs(jobs, { experienceYears: '4', includeUnknownExperience: true }, now).map(item => item.id)), new Set(['four', 'range', 'unknown']));
  assert.equal(filterJobs(jobs, { experienceYears: '5' }, now).length, 4);
  assert.equal(filterJobs(jobs, { experienceYears: '' }, now).length, 5);
});

test('zero years is a real experience filter and previous saved jobs are reparsed', () => {
  const jobs = [job({ id: 'zero', description: '0-2 years of engineering experience.' }), job({ id: 'two', description: '2+ years of Java experience.' })];
  assert.deepEqual(filterJobs(jobs, { experienceYears: '0' }, now).map(item => item.id), ['zero']);
});

test('only fully remote US roles survive, including when old filters request any country', () => {
  const jobs = [job(), job({ id: 'worldwide', location: 'Worldwide' }), job({ id: 'hybrid', workplace: 'hybrid' }), job({ id: 'onsite', workplace: 'onsite' }), job({ id: 'unspecified', workplace: 'unknown' }), job({ id: 'office-days', description: 'This role is hybrid with 3 days per week in the office.' }), job({ id: 'not-remote', description: 'This is not a remote position.' })];
  assert.deepEqual(filterJobs(jobs, { country: 'any', workplace: '' }, now).map(item => item.id), ['1']);
  assert.equal(isUSRemoteJob(job({ location: 'USA, Hybrid', workplace: 'remote' })), false);
  assert.equal(isUSRemoteJob(job({ description: 'You must work on-site in New York.' })), false);
  assert.equal(isUSRemoteJob(job({ description: 'Work in the office at least three days per week.' })), false);
});

test('the API excludes non-US and non-remote jobs and reports scoped source counts', async () => {
  const service = createJobService({ sources: { jobicy: true }, maxPages: 1, requestTimeoutMs: 1000 }, { fetchImpl: async () => ({ ok: true, json: async () => ({ jobs: [
    { id: 1, jobTitle: 'Software Engineer', jobGeo: 'USA', jobDescription: '4 years of Java experience.', url: 'https://example.com/1' },
    { id: 2, jobTitle: 'Software Engineer', jobGeo: 'Worldwide', url: 'https://example.com/2' },
    { id: 3, jobTitle: 'Software Engineer', jobGeo: 'USA', jobDescription: 'This position is hybrid.', url: 'https://example.com/3' },
  ] }) }) });
  const data = await service.getJobs();
  assert.equal(data.jobs.length, 1);
  assert.equal(data.sources[0].count, 1);
  assert.equal(data.jobs[0].requiredExperience.minYears, 4);
});

test('HTML descriptions become inert readable text', () => {
  assert.equal(plainText('&lt;p&gt;Java &amp;amp; AWS&lt;/p&gt;<script>alert(1)</script>'), 'Java & AWS');
  assert.ok(plainText('<ul><li>Build software</li><li>Use Java</li></ul>').includes('• Use Java'));
});

test('Greenhouse preserves original date, structured salary and explicit arrangement', () => {
  const result = normalizeGreenhouse({ id: 1, title: 'Software Engineer', absolute_url: 'https://example.com/apply', location: { name: 'Hybrid' }, offices: [{ location: 'Austin, TX, United States' }], first_published: '2026-08-01T00:00:00Z', updated_at: '2026-10-15T00:00:00Z', content: '&lt;p&gt;Java&lt;/p&gt;', pay_input_ranges: [{ min_cents: 12000000, max_cents: 18000000, currency_type: 'USD', title: 'Yearly salary' }] }, { id: 'gh', name: 'Example direct', company: 'Example', url: 'https://example.com' });
  assert.equal(result.salary.min, 120000);
  assert.equal(result.salary.period, 'year');
  assert.equal(result.workplace, 'hybrid');
  assert.equal(result.postedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(result.description, 'Java');
});

test('unsafe application links and expired listings are excluded', () => {
  const raw = { title: 'Software Engineer', companyName: 'Example', applicationLink: 'javascript:alert(1)' };
  const source = { id: 'h', name: 'Himalayas', url: 'https://himalayas.app' };
  assert.equal(normalizeHimalayas(raw, source), null);
  assert.equal(normalizeHimalayas({ ...raw, applicationLink: 'https://example.com', expiryDate: 1 }, source), null);
});

test('feeds paginate with opaque cursors, cache and coalesce concurrent requests', async () => {
  let calls = 0;
  const service = createJobService({ sources: { jobicy: true }, maxPages: 3, requestTimeoutMs: 1000 }, { now: () => now, fetchImpl: async (url) => {
    calls++;
    return { ok: true, json: async () => ({ jobs: [{ id: calls, jobTitle: 'Software Engineer', companyName: `Company ${calls}`, jobGeo: 'USA', url: `https://example.com/${calls}`, pubDate: '2026-10-15T00:00:00Z' }], nextCursor: new URL(url).searchParams.has('cursor') ? null : 'opaque-token' }) };
  } });
  const [first, second] = await Promise.all([service.getJobs(), service.getJobs()]);
  assert.equal(calls, 2);
  assert.equal(first.jobs.length, 2);
  assert.equal(second.jobs.length, 2);
  await service.getJobs();
  assert.equal(calls, 2);
});

test('provider failures retain cached results and report them as stale', async () => {
  let clock = now, fail = false;
  const service = createJobService({ sources: { jobicy: true }, maxPages: 1, requestTimeoutMs: 1000 }, { now: () => clock, fetchImpl: async () => {
    if (fail) throw new Error('fetch failed');
    return { ok: true, json: async () => ({ jobs: [{ id: 1, jobTitle: 'Software Engineer', companyName: 'Example', jobGeo: 'USA', url: 'https://example.com' }] }) };
  } });
  const first = await service.getJobs();
  clock += 3600001; fail = true;
  const second = await service.getJobs();
  assert.equal(second.jobs.length, 1);
  assert.ok(second.sources[0].stale);
  assert.equal(second.sources[0].fetchedAt, first.sources[0].fetchedAt);
  assert.match(second.sources[0].error, /connect/);
});

test('partial first loads keep usable results when a later page fails', async () => {
  let calls = 0;
  const service = createJobService({ sources: { jobicy: true }, maxPages: 3, requestTimeoutMs: 1000 }, { fetchImpl: async () => {
    if (++calls > 1) return { ok: false, status: 429 };
    return { ok: true, json: async () => ({ jobs: [{ id: 1, jobTitle: 'Software Engineer', jobGeo: 'USA', url: 'https://example.com' }], nextCursor: 'next' }) };
  } });
  const result = await service.getJobs();
  assert.equal(result.jobs.length, 1);
  assert.ok(result.sources[0].partial);
  assert.match(result.sources[0].error, /Rate limited/);
});
