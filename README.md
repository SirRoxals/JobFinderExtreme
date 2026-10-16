# JobFinder Extreme

A local website for finding **US-eligible, fully remote, hands-on software engineering jobs**. Launch it, enter your preferences in the page, and search across companies automatically. **No company lists or configuration files to maintain.** No database or domain is needed. Public searches work without an account or API key; optional **JSearch** coverage uses your own key, entered through the local UI and held only in server memory. The app uses Node.js and pinned libraries; internet access is required.

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
5. Choose **Last 12 hours**, **Last 24 hours**, a longer posting window (30 days by default), **Any time**, or an inclusive custom date range in your local timezone. The 12-hour and 24-hour choices are rolling intervals across midnight, not calendar-day shortcuts. Invalid/reversed dates are rejected. Missing dates are excluded when a boundary is active.
6. Salary is optional. Undisclosed pay is included by default. Expand **Salary & location** to set an annual USD minimum or city/state. Other currencies and unknown periods are displayed without invented conversions.
7. Press **Search online** / **Find matching jobs**. Role, focus, keyword, date-window, and depth changes also trigger an online search after a short typing pause. Experience and salary changes filter the discovered pool immediately.

**Results appear as pages arrive**, so you can browse, filter, save, and open jobs while the remaining sources run. The broad catalogue follows every available page automatically, up to the provider's 10,000-candidate boundary. **Deep** extends supplementary indexes and Indeed/LinkedIn; it is not needed to reach the end of a smaller catalogue search. Previously loaded results remain visible until the new search supplies data. A failed index does not hide results from working indexes.

The stats distinguish **matching roles** from **24h · before filters**: the latter counts fetched US remote software roles before your keyword, experience and salary filters. The search summary shows how many fall inside the selected posting window and how many match your preferences. With keywords entered, the experience summary also shows how many pass your other filters before keywords. Finding 100 roles in the market does not imply 100 will match Java and a particular experience requirement.

Use **Comfortable** (default) for larger text and one job per row, or **Compact** for a denser layout. On small screens, **Preferences** opens a drawer. **Ctrl+K** / **Cmd+K** focuses search. Open a title for the description and experience evidence, save jobs in this browser, or export all matches as CSV. Saved jobs are rechecked against current role/scope rules and may have closed since being saved.

## Mandatory scope

- **US eligibility:** explicit job-country metadata or the job location must identify the United States. Worldwide-only, Americas-only, unknown-country, and non-US listings are excluded. A company being headquartered in the US is not evidence of US job eligibility. A listing can name the US alongside other eligible countries.
- **Fully remote:** an explicit remote arrangement is required. Hybrid, office, unspecified, and recognizable mandatory office schedules are excluded even when an upstream feed labels the job remote.
- **Software development individual contributors:** general software, backend, frontend, full-stack, web, mobile, application, language-specific, firmware, and embedded software roles are eligible. Managers/directors/executives, Salesforce/CRM/ERP/platform specialists, support, sales/solutions, DevOps/SRE, infrastructure, standalone security/data engineering, QA/testing, and unrelated engineering disciplines are excluded. A low years requirement cannot make a manager or Salesforce role eligible.

Role and requirement parsing use deterministic text rules, not a claim that every listing has been manually verified. Experience requirements, state/residency, authorization, education, timezone, travel, and availability should still be checked on the original listing. No application is submitted automatically.

## Optional broader search with JSearch

1. Get an API key from [OpenWeb Ninja JSearch](https://www.openwebninja.com/api/jsearch). In their portal, open **Account → Settings** to copy it. No key is included with this project.
2. Click **Connect JSearch** above the results, paste the key, choose a maximum request budget, and connect. Your plan's remaining allowance and reset date appear in the page.
3. Set your normal search criteria, then press **Search with JSearch**. This combines the public sources with Google for Jobs results from additional publishers. Mandatory scope, keywords, dates and experience checks still apply locally.

The default budget is **20 credits per search**, adjustable to 5, 10, 20 or 40 in the UI. Each new API result page costs one credit and supplies up to 10 candidates. Candidates can duplicate existing jobs or fail your filters; 200 candidates does not mean 200 matches. Searches rotate across software-role and publisher-specific queries, then follow opaque pagination cursors. The app checks the provider's remaining allowance before new requests, stops at your budget or remaining credits, and retains good results if a later page fails. Failed attempts are conservatively counted against the local budget too. The displayed allowance starts from the provider's latest check, then subtracts this app's attempted requests; other clients or refunded failures can change the actual balance. It does not subscribe to a paid plan or deliberately continue into overage when the reported allowance is exhausted. Check the provider's current pricing before selecting a plan.

**Typing, automatic searches, Search online, Find matching jobs, refresh, and Deep search use public sources only.** Only **Search with JSearch** invokes this integration. Completed identical JSearch searches reuse results for 15 minutes without more search credits. Partial searches reuse successful pages and can retry failed queries within the budget. A larger budget can reuse earlier pages and fetch additional ones. The 12-hour and 24-hour options share the provider's one-day bucket, with the exact chosen cutoff applied locally. Custom ranges request all upstream dates and are narrowed locally.

**The key is never saved to disk, a config file, browser storage, a URL, a log, job results, or Git.** The browser sends it to the loopback server in a JSON request body; the server sends it only as an HTTPS header to `api.openwebninja.com`. Connection/status responses never return it. Closing the settings dialog clears the input; **Disconnect** or stopping the server clears the connection. Re-enter the key after restarting. Do not add a key to the source or README.

## Automatic discovery and coverage

The main discovery path is a broad cross-company catalogue, supplemented by direct major-board searches and specialist indexes. It does not use a shortlist of configured employers:

| Index | How it is used |
| --- | --- |
| [JSearch](https://www.openwebninja.com/api/jsearch) (optional) | Explicit, budgeted searches of Google for Jobs through the OpenWeb Ninja API. Uses your UI-entered key, full descriptions, job-country/remote metadata, publisher dates and direct employer apply links where supplied. Publisher results are checked and deduplicated alongside the public sources. No guaranteed result count. |
| [Freehire](https://freehire.me/docs/api) | Public, keyless index spanning ATS platforms and job boards. Fetches **full descriptions**, 100 candidates per page, following every available page automatically up to 10,000 candidates. US remote software categories and source dates are requested upstream and checked locally. Greenhouse, Ashby, Lever, Workday, iCIMS, SmartRecruiters and other systems are reached through the catalogue without employer setup. |
| [Indeed](https://www.indeed.com/) | Direct cross-company search using pinned [ts-jobspy](https://github.com/alpharomercoma/ts-jobspy), expanded into broad role queries and keyword-specific searches. Requests up to 500 candidates per query in Standard / 1,000 in Deep. Structured source workplace attributes or explicit full posting text must establish remote work; the scraper flag alone is insufficient. Exact **when listed on Indeed** timestamps are retained, with original publication dates shown for possible reposts. The library does not expose its page count. |
| [LinkedIn](https://www.linkedin.com/jobs/) | Public guest search followed by full posting-page verification. The guest API's remote search flag alone is insufficient. Standard reads up to 6 search pages / 60 posting pages; Deep up to 12 / 120 within 90 seconds. Blocks and sign-in requirements are reported; blocking pauses public requests for 15 minutes. No login cookies, account automation, CAPTCHA solving or proxy rotation. |
| [Dice](https://www.dice.com/) | Public US remote searches driven by your keywords, followed by full posting-page verification. Uses original posting timestamps rather than modification dates. Reads up to 20 search pages in Standard / 40 in Deep, with bounded posting-page concurrency and a 90-second budget per query. Similar-job recommendations are never mistaken for search results. |
| [Built In](https://builtin.com/) | Public remote search and full posting-page checks. Explicit posted/reposted time labels are kept as approximate ranges, with reposts marked. Mixed office/remote arrangements are excluded. Reads up to 15 search pages in Standard / 30 in Deep within 90 seconds. |
| [Jobs by Workable](https://jobs.workable.com/) | Public website search across employers, queried for US/remote roles using expanded software-role and skill terms. Cursor pagination is followed automatically. The website endpoint can change or restrict requests. |
| [Himalayas](https://himalayas.app/docs/remote-jobs-api) | Public country/keyword search with worldwide-only matches excluded, paginated automatically. Upstream data refreshes daily; anonymous access may change. |
| [Jobicy](https://jobicy.com/jobs-rss-feed) | US engineering feed covering the past 7 days, with an upstream 3-hour delay. |
| [Remotive](https://github.com/remotive-com/remote-jobs-api) | Public software feed, with an upstream 24-hour delay. |
| [Remote OK](https://remoteok.com/api) | Recent public remote feed, checked locally for US software-development scope. |
| [We Work Remotely](https://weworkremotely.com/remote-job-rss-feed) | Public programming RSS, using job region/explicit job location rather than headquarters. |
| [Working Nomads](https://www.workingnomads.com/api/exposed_jobs/) | Public remote jobs feed, checked for US eligibility and software-development scope. |

For an empty role search, Indeed/Workable expand software-role families. Entered roles/focus/skills drive corresponding searches. For windows up to three days, the catalogue inspects all US remote categories, then applies the mandatory software-role gate locally, so upstream misclassification does not hide coding jobs. Longer windows request software categories. Full descriptions support keyword ALL/ANY and experience checks. Java17 and JavaEE8 match Java; JavaScript does not.

Application URLs are deduplicated after removing tracking and equivalent application-page suffixes. **Different requisitions with the same company, title and location remain separate.** Exact full-description copies across indexes are deduplicated. Salary omission is not a rejection reason.

**This does not cover every job on the internet, and counts are not guaranteed.** Restricted boards, source delays, tagging mistakes, reposts, closed jobs, text ambiguity and pagination boundaries affect coverage. Dates are source-reported, not proof a role first appeared today; crawl/update timestamps never replace missing posting dates. Known possible-repost warnings appear in job details. A completed search describes the work performed, not exhaustive market coverage. The coverage panel reports fetched candidates, underlying sources, accepted roles, errors and limits. Classification is automatic, not manual verification.

Standard reads up to 15 Workable pages and 12 Himalayas pages per query; Deep raises those to 50 and 40. Both follow all available pages when the result ends sooner. Other feeds use their published result windows, with Jobicy cursor traversal capped at 20 pages. Requests run with bounded concurrency and per-query time budgets. Active individual fetches may finish into the shared cache when you change a search, so a cancelled tab does not corrupt another tab's results.

Responses are cached only in server memory: Freehire/Indeed/LinkedIn for 15 minutes, Workable for 30 minutes, Himalayas for 24 hours, Remotive for 6 hours, and the remaining feeds for 1 hour. Page data is reused across searches and deeper traversals. The cache clears on restart. Identical checks reuse cached data until due; query changes fetch uncached searches.

Dice and Built In searches are cached for 15 minutes. A precise provider timestamp remains precise. When a provider supplies only whole-day or relative-hour information, the app does not invent a publication time: Built In ranges must fit completely inside your requested window. A label of 12 hours ago might mean 12 hours 59 minutes, so it cannot pass the strict 12-hour cutoff. Reposted roles are labeled separately from first publication.

`lib/jobspy-client.mjs` contains a version-checked compatibility adapter for the pinned library. Its default output discards the time portion and chooses a date field different from its freshness filter. The adapter retains the full listing timestamp, original publication timestamp and structured remote evidence in memory. It does not modify installed files or write generated code. An unexpected library version fails visibly instead of silently reverting to inaccurate dates.

**Expand your search** also offers popular boards in separate tabs. Shortcut results are never imported or counted merely because a link exists. External filter support varies; confirm dates, experience and scope there. Indeed's date and remote filter groups are mutually exclusive in the library version used: the app sends the date filter, includes remote in the query, and checks full posting text locally rather than silently dropping a mandatory filter. Public major-board access can change or be blocked; failures remain visible.

## Privacy and public GitHub use

The source contains no personal user profile, experience value, resume, contact details, credentials, saved jobs, or machine-specific home paths. Preferences and saved jobs stay in browser local storage. Clearing browser data removes them; `localhost` and `127.0.0.1` use separate browser storage. The server has no database and writes no job/search data into the repository.

Role/skill searches and broad date-window criteria are sent to the queried providers. Your numeric experience, salary threshold, and saved list are applied locally. External links send their search query when you open them. No analytics, external fonts, or tracking images are loaded by the UI.

`.gitignore` excludes environment files, legacy local settings, private keys/certificates, generated CSVs, screenshots, exports, and test artifacts. Save manual exports outside the checkout or under `exports/`. Never commit personal documents or secrets. Git author metadata is separate from app data; use a GitHub noreply identity if you do not want a personal email in commit history. The npm `private` flag prevents npm publication and does not change GitHub repository visibility.

The server binds only to `127.0.0.1`, validates Host headers, serves an explicit asset list, and renders feed descriptions as inert text. Assets and searches permit GET/HEAD. The connection endpoint additionally permits same-origin POST/DELETE, requires JSON for connection settings, bounds request-body size, and never echoes keys. Credit-consuming searches require a custom same-origin request header. It ignores legacy `jobs.config.json` / `jobs.local.json`; all job-search preferences are entered in the UI.

## Validate

```powershell
npm run check
npm test
```

Tests cover JSearch opt-in behavior, request/remaining-quota caps, cursor pagination, zero-credit cache reuse, partial failures, concurrent searches, disconnects, origin checks and secret redaction, plus 12/24-hour cutoffs, real provider timestamp conversion with mocked transport, distinct requisitions, versioned keywords, Dice pagination, relative-time bounds and existing scope/filter rules.

`server.mjs` serves the UI and search stream; `lib/discovery.mjs` combines providers; `lib/sources.mjs`, `lib/indeed.mjs`, `lib/linkedin.mjs`, `lib/dice.mjs`, `lib/builtin.mjs` and `lib/jsearch.mjs` handle acquisition; `lib/jobs.mjs` applies matching rules; `public/` contains the interface. No source/provider configuration file is required to run the app.
