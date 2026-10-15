# JobFinder Extreme

A local website for finding **US-eligible, fully remote, hands-on software engineering jobs**. Launch it, enter your preferences in the page, and search across companies automatically. **No company lists or configuration files to maintain.** No database, domain, personal account, or personal API key is required. The app uses Node.js and a pinned job-search library; internet access is required.

## Launch

Install [Node.js 22 or newer](https://nodejs.org/), then double-click **start.cmd** on Windows. It installs the search library automatically on the first launch. From a terminal, run:

```powershell
npm ci --ignore-scripts
npm start
```

The browser opens **http://127.0.0.1:3000**. Keep the terminal open; **Ctrl+C** stops the app. No build step is needed. `npm run dev` enables file watching. If port 3000 is occupied, close the earlier instance or set the `PORT` environment variable. Restart an already-running server after updating the source.

## Search from the page

1. Enter a role or leave it blank to search across software development roles. Select a focus such as backend, frontend, full stack, mobile, or embedded if needed.
2. Enter comma-separated tech keywords, such as `Java, AWS`. Choose **Match all** or **Match any**. The app checks the full description and respects word boundaries, including Java versus JavaScript, C++, C#, and .NET.
3. Enter your years of experience. Known minimums above that number are excluded. Below five years, senior, lead, staff, principal, and level III/IV titles are also excluded. Requirements such as 3–5 years use their minimum of 3.
4. Unstated experience years remain visible by default, labeled **review fit**. These are not claimed to match your experience. Turn off **Include unstated years** for strict matches only. The results explain how many have stated requirements versus unstated years.
5. Choose a posting window (30 days by default), **Any time**, or an inclusive custom start/end date range in your local timezone. Invalid/reversed dates are rejected. Missing dates are excluded when a boundary is active.
6. Salary is optional. Undisclosed pay is included by default. Expand **Salary & location** to set an annual USD minimum or city/state. Other currencies and unknown periods are displayed without invented conversions.
7. Press **Search online** / **Find matching jobs**. Role, focus, keyword, date-window, and depth changes also trigger an online search after a short typing pause. Experience and salary changes filter the discovered pool immediately.

**Results appear as pages arrive**, so you can browse, filter, save, and open jobs while the remaining sources run. The broad catalogue follows every available page automatically, up to the provider's 10,000-candidate boundary. **Deep** extends supplementary indexes and Indeed/LinkedIn; it is not needed to reach the end of a smaller catalogue search. Previously loaded results remain visible until the new search supplies data. A failed index does not hide results from working indexes.

Use **Comfortable** (default) for larger text and one job per row, or **Compact** for a denser layout. On small screens, **Preferences** opens a drawer. **Ctrl+K** / **Cmd+K** focuses search. Open a title for the description and experience evidence, save jobs in this browser, or export all matches as CSV. Saved jobs are rechecked against current role/scope rules and may have closed since being saved.

## Mandatory scope

- **US eligibility:** explicit job-country metadata or the job location must identify the United States. Worldwide-only, Americas-only, unknown-country, and non-US listings are excluded. A company being headquartered in the US is not evidence of US job eligibility. A listing can name the US alongside other eligible countries.
- **Fully remote:** an explicit remote arrangement is required. Hybrid, office, unspecified, and recognizable mandatory office schedules are excluded even when an upstream feed labels the job remote.
- **Software development individual contributors:** general software, backend, frontend, full-stack, web, mobile, application, language-specific, firmware, and embedded software roles are eligible. Managers/directors/executives, Salesforce/CRM/ERP/platform specialists, support, sales/solutions, DevOps/SRE, infrastructure, standalone security/data engineering, QA/testing, and unrelated engineering disciplines are excluded. A low years requirement cannot make a manager or Salesforce role eligible.

Role and requirement parsing use deterministic text rules, not a claim that every listing has been manually verified. Experience requirements, state/residency, authorization, education, timezone, travel, and availability should still be checked on the original listing. No application is submitted automatically.

## Automatic discovery and coverage

The main discovery path is a broad cross-company catalogue, supplemented by direct major-board searches and specialist indexes. It does not use a shortlist of configured employers:

| Index | How it is used |
| --- | --- |
| [Freehire](https://freehire.me/docs/api) | Public, keyless index spanning ATS platforms and job boards. Fetches **full descriptions**, 100 candidates per page, following every available page automatically up to 10,000 candidates. US remote software categories and source dates are requested upstream and checked locally. Greenhouse, Ashby, Lever, Workday, iCIMS, SmartRecruiters and other systems are reached through the catalogue without employer setup. |
| [Indeed](https://www.indeed.com/) | Direct cross-company search using pinned [ts-jobspy](https://github.com/alpharomercoma/ts-jobspy). Broad searches expand into six software-role queries, up to 500 candidates each in Standard / 1,000 in Deep. Full posting text must establish remote work; the scraper's remote flag alone is insufficient. Date constraints are requested upstream. The library does not expose its page count. |
| [LinkedIn](https://www.linkedin.com/jobs/) | Public guest search followed by full posting-page verification. The guest API's remote search flag alone is insufficient. Standard reads up to 6 search pages / 60 posting pages; Deep up to 12 / 120 within 90 seconds. Blocks and sign-in requirements are reported; blocking pauses public requests for 15 minutes. No login cookies, account automation, CAPTCHA solving or proxy rotation. |
| [Jobs by Workable](https://jobs.workable.com/) | Public website search across employers, queried for US/remote roles using expanded software-role and skill terms. Cursor pagination is followed automatically. The website endpoint can change or restrict requests. |
| [Himalayas](https://himalayas.app/docs/remote-jobs-api) | Public country/keyword search with worldwide-only matches excluded, paginated automatically. Upstream data refreshes daily; anonymous access may change. |
| [Jobicy](https://jobicy.com/jobs-rss-feed) | US engineering feed covering the past 7 days, with an upstream 3-hour delay. |
| [Remotive](https://github.com/remotive-com/remote-jobs-api) | Public software feed, with an upstream 24-hour delay. |
| [Remote OK](https://remoteok.com/api) | Recent public remote feed, checked locally for US software-development scope. |
| [We Work Remotely](https://weworkremotely.com/remote-job-rss-feed) | Public programming RSS, using job region/explicit job location rather than headquarters. |
| [Working Nomads](https://www.workingnomads.com/api/exposed_jobs/) | Public remote jobs feed, checked for US eligibility and software-development scope. |

For an empty role search, the catalogue searches software-development categories and Indeed/Workable expand software-role families. Entered roles/focus/skills drive corresponding searches. The catalogue downloads full descriptions so keyword ALL/ANY and experience checks work locally, rather than testing snippets. Application URLs are deduplicated after removing known tracking parameters, including syndicated city variants. Different URLs and locations can represent different openings. Salary omission is not a rejection reason.

**This does not cover every job on the internet, and counts are not guaranteed.** Restricted boards, source delays, tagging mistakes, reposts, closed jobs, text ambiguity and pagination boundaries affect coverage. Dates are source-reported, not proof a role first appeared today; crawl/update timestamps never replace missing posting dates. Known possible-repost warnings appear in job details. A completed search describes the work performed, not exhaustive market coverage. The coverage panel reports fetched candidates, underlying sources, accepted roles, errors and limits. Classification is automatic, not manual verification.

Standard reads up to 15 Workable pages and 12 Himalayas pages per query; Deep raises those to 50 and 40. Both follow all available pages when the result ends sooner. Other feeds use their published result windows, with Jobicy cursor traversal capped at 20 pages. Requests run with bounded concurrency and per-query time budgets. Active individual fetches may finish into the shared cache when you change a search, so a cancelled tab does not corrupt another tab's results.

Responses are cached only in server memory: Freehire/Indeed/LinkedIn for 15 minutes, Workable for 30 minutes, Himalayas for 24 hours, Remotive for 6 hours, and the remaining feeds for 1 hour. Page data is reused across searches and deeper traversals. The cache clears on restart. Identical checks reuse cached data until due; query changes fetch uncached searches.

**Expand your search** also offers popular boards in separate tabs. Shortcut results are never imported or counted merely because a link exists. External filter support varies; confirm dates, experience and scope there. Indeed's date and remote filter groups are mutually exclusive in the library version used: the app sends the date filter, includes remote in the query, and checks full posting text locally rather than silently dropping a mandatory filter. Public major-board access can change or be blocked; failures remain visible.

## Privacy and public GitHub use

The source contains no personal user profile, experience value, resume, contact details, credentials, saved jobs, or machine-specific home paths. Preferences and saved jobs stay in browser local storage. Clearing browser data removes them; `localhost` and `127.0.0.1` use separate browser storage. The server has no database and writes no job/search data into the repository.

Role/skill searches and broad date-window criteria are sent to the queried providers. Your numeric experience, salary threshold, and saved list are applied locally. External links send their search query when you open them. No analytics, external fonts, or tracking images are loaded by the UI.

`.gitignore` excludes environment files, legacy local settings, private keys/certificates, generated CSVs, screenshots, exports, and test artifacts. Save manual exports outside the checkout or under `exports/`. Never commit personal documents or secrets. Git author metadata is separate from app data; use a GitHub noreply identity if you do not want a personal email in commit history. The npm `private` flag prevents npm publication and does not change GitHub repository visibility.

The server binds only to `127.0.0.1`, validates Host headers, permits GET/HEAD, serves an explicit asset list, and renders feed descriptions as inert text. It ignores legacy `jobs.config.json` / `jobs.local.json`; all job-search preferences are entered in the UI.

## Validate

```powershell
npm run check
npm test
```

Tests cover bulk pagination, streamed batches, caching, partial failures, block cooldowns, deduplication, full-description verification, role regressions, seniority, numeric experience, geography/remote rules, salary, keywords, inclusive dates and daylight saving, dynamic queries, concurrency and ignored artifacts.

`server.mjs` serves the UI and search stream; `lib/discovery.mjs` combines providers; `lib/sources.mjs`, `lib/indeed.mjs` and `lib/linkedin.mjs` handle acquisition; `lib/jobs.mjs` applies matching rules; `public/` contains the interface. No source/provider configuration file is required to run the app.
