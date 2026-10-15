import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchService, searchPlan } from '../lib/discovery.mjs';
import { filterJobs, roleFamily } from '../lib/jobs.mjs';

test('search plans query cross-company indexes from UI criteria without employer allowlists', () => {
  const plan = searchPlan({ role: 'Java developer', keywords: 'AWS', days: '7' });
  const workable = plan.filter(source => source.providerId === 'workable');
  assert.ok(workable.length >= 2);
  const url = new URL(workable[0].endpoint);
  assert.equal(url.searchParams.get('query'), 'Java developer');
  assert.equal(url.searchParams.get('location'), 'United States');
  assert.equal(url.searchParams.get('workplace'), 'remote');
  assert.ok(workable.some(source => source.query.includes('AWS')));
  assert.ok(plan.every(source => !source.endpoint.includes('boards-api.greenhouse.io')));
  const deep = searchPlan({ depth: 'deep' }).find(source => source.providerId === 'workable');
  assert.ok(deep.maxPages > workable[0].maxPages);
  const himalayas = new URL(plan.find(source => source.providerId === 'himalayas').endpoint);
  assert.equal(himalayas.searchParams.get('exclude_worldwide'), 'true');
});

test('mobile and backend focus are categorized from coding titles', () => {
  assert.equal(roleFamily('React Native Developer'), 'mobile');
  assert.equal(roleFamily('Backend Software Engineer'), 'backend');
  const plan = searchPlan({ roleFocus: 'frontend' });
  assert.ok(plan.filter(source => source.providerId === 'workable').every(source => source.query.includes('frontend')));
});

test('online discovery paginates, includes unlisted companies, rejects invalid roles, and shares caches', async () => {
  const calls = [], progress = [];
  const now = Date.parse('2026-10-15T12:00:00Z');
  const service = createSearchService({ now: () => now, indeedService: { getJobs: async () => ({ jobs: [], source: { id: 'indeed', name: 'Indeed', queryCount: 0 } }) }, linkedinService: { getJobs: async () => ({ jobs: [], source: { id: 'linkedin', name: 'LinkedIn', pages: 0, count: 0 } }) }, fetchImpl: async input => {
    const url = new URL(input); calls.push(url.href);
    let data;
    if (url.hostname === 'jobs.workable.com') {
      const base = { title: 'Software Engineer', company: { title: 'An Unlisted Employer' }, state: 'published', locations: ['Remote, United States'], location: { countryName: 'United States' }, workplace: 'remote', description: 'Develop Java applications.', requirementsSection: '<p>3 years of software development experience.</p>', created: '2026-10-15T10:00:00Z', url: 'https://jobs.workable.com/view/example' };
      data = url.searchParams.has('pageToken') ? { jobs: [{ ...base, id: 'second', title: 'Backend Developer', url: 'https://jobs.workable.com/view/second' }] } : { jobs: [{ ...base, id: 'first' }, { ...base, id: 'manager', title: 'Senior Software Engineering Manager' }, { ...base, id: 'crm', title: 'Salesforce Developer III' }, { ...base, id: 'hybrid', title: 'Frontend Engineer', workplace: 'hybrid' }, { ...base, id: 'foreign', title: 'Mobile Engineer', locations: ['London, United Kingdom'], location: { countryName: 'United Kingdom' } }], nextPageToken: 'opaque-page-two' };
    } else if (url.hostname === 'freehire.me') data = { data: [], meta: { total: 0 } };
    else if (['remoteok.com', 'www.workingnomads.com'].includes(url.hostname)) data = [];
    else data = { jobs: [], totalCount: 0 };
    return { ok: true, json: async () => data, text: async () => '<rss><channel/></rss>' };
  } });
  const result = await service.getJobs({ role: 'Software Engineer', days: '30' }, { onProgress: event => progress.push(event) });
  assert.equal(result.jobs.length, 2);
  assert.ok(result.jobs.every(job => job.company === 'An Unlisted Employer'));
  assert.equal(filterJobs(result.jobs, { experienceYears: '4', includeUnknownExperience: true }, now).length, 2);
  assert.ok(calls.some(url => new URL(url).searchParams.get('pageToken') === 'opaque-page-two'));
  assert.ok(progress.some(event => event.pages === 2));
  assert.equal(result.sources.length, 10);
  const before = calls.length;
  await service.getJobs({ role: 'Software Engineer', days: '30' });
  assert.equal(calls.length, before);
  await service.getJobs({ role: 'Backend', days: '30' });
  assert.ok(calls.slice(before).some(url => new URL(url).searchParams.get('query') === 'Backend'));
});
