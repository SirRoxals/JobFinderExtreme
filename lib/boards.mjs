// External searches are launchers, never represented as imported local results.
export function buildBoardSearches(filters = {}) {
  const words = String(filters.keywords || '').split(/[,;\n]/).map(word => word.trim()).filter(Boolean);
  const query = [filters.role || 'software engineer', ...words].join(' ');
  const location = filters.location ? `${filters.location}, United States` : 'United States';
  const days = ['0.5', '1', '3', '7', '14', '30'].includes(String(filters.days)) ? Number(filters.days) : null;
  const make = (base, params) => { const url = new URL(base); for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value); return url.href; };
  return [
    { name: 'LinkedIn', short: 'in', color: 'blue', note: 'US · remote · newest first', url: make('https://www.linkedin.com/jobs/search/', { keywords: query, location, geoId: '103644278', f_WT: '2', sortBy: 'DD', f_TPR: days ? `r${days * 86400}` : null }) },
    { name: 'Indeed', short: 'i', color: 'indigo', note: days === 0.5 ? '12h unavailable here · opens past day' : 'Remote search · recent posts', url: make('https://www.indeed.com/jobs', { q: `${query} remote`, l: location, sort: 'date', fromage: days ? Math.ceil(days) : null }) },
    { name: 'Glassdoor', short: 'g', color: 'green', note: 'Search roles and company reviews', url: make('https://www.glassdoor.com/Job/jobs.htm', { sc_keyword: `${query} remote United States` }) },
    { name: 'Dice', short: 'D', color: 'red', note: 'Tech-focused opportunities', url: make('https://www.dice.com/jobs', { q: query, location, filters: JSON.stringify({ workplaceTypes: { Remote: true } }) }) },
    { name: 'Built In', short: 'b', color: 'blue', note: 'Remote software roles', url: make('https://builtin.com/jobs/remote', { search: query }) },
    { name: 'Wellfound', short: 'w', color: 'slate', note: 'Startup opportunities', url: 'https://wellfound.com/role/r/software-engineer' },
    { name: 'Work at a Startup', short: 'Y', color: 'orange', note: 'Y Combinator companies', url: 'https://www.workatastartup.com/jobs' },
    { name: 'ZipRecruiter', short: 'z', color: 'green', note: 'US remote job search', url: make('https://www.ziprecruiter.com/jobs-search', { search: `${query} remote`, location }) },
  ];
}
