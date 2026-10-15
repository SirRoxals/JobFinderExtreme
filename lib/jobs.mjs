// Shared, dependency-free matching rules used by the browser and server tests.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', bull: '•' };

export function decodeEntities(value = '') {
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith('#')) {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function plainText(value = '') {
  // Greenhouse encodes the HTML itself. Never insert feed HTML into the DOM.
  return decodeEntities(decodeEntities(value))
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\s*li\b[^>]*>/gi, '\n• ')
    .replace(/<\s*(?:br|\/p|\/div|\/h[1-6]|\/ul|\/ol)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
}

export function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}

export function isoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const time = typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : value;
  // Public feeds sometimes omit the UTC suffix.
  const date = new Date(typeof time === 'string' && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d$/.test(time) ? `${time.replace(' ', 'T')}Z` : time);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isSoftwareJob(title = '') {
  const text = title.toLowerCase();
  // Scope is hands-on software development, not adjacent IT or people management.
  if (/\b(manager|management|director|head|chief|cto|vp|vice president|architect|recruiter|advoca(?:te|cy)|evangelist|devrel|technical writer|product owner|scrum master)\b/.test(text)) return false;
  if (/\b(?:instructor|tutor|teacher|trainer|annotator|annotation|talent pool|talent community)\b/.test(text)) return false;
  if (/\b(developer relations|business develop(?:er|ment)|business intelligence|bi developer|content developer|curriculum developer|learning developer|training developer|real estate|tableau|power ?bi|qlik|etl|sql developer|cnc|plc)\b/.test(text)) return false;
  if (/\b(salesforce|sfdc|apex|visualforce|servicenow|service now|dynamics|sap|erp|crm|netsuite|workday|sharepoint|power ?apps|power ?platform|rpa|wordpress|shopify|low.code|no.code)\b/.test(text)) return false;
  if (/\b(sales|solutions?|support|customer success|field|electrical|mechanical|civil|network|hardware|manufacturing|qa|sdet|test|testing|data engineer|data scientist|devops|sre|site reliability|security engineer|cloud engineer|infrastructure engineer|platform engineer)\b/.test(text)) return false;
  return /\b(software\s+(?:development\s+)?(?:engineer|engineering|developer)|(?:front.?end|back.?end|full.?stack|web|mobile|ios|android|application|applications|api|java|python|golang|rust|ruby|javascript|typescript|react|node\.?js|c\+\+|c#|\.net|firmware|embedded)\s+(?:software\s+)?(?:engineer|developer)|programmer|developer)\b/.test(text);
}

export function roleFamily(title = '') {
  if (/\b(?:mobile|ios|android|flutter|react native)\b/i.test(title)) return 'mobile';
  if (/front.?end|\b(?:react|angular|vue)\b/i.test(title)) return 'frontend';
  if (/back.?end|\bapi\b/i.test(title)) return 'backend';
  if (/full.?stack/i.test(title)) return 'fullstack';
  if (/\b(?:embedded|firmware)\b/i.test(title)) return 'embedded';
  return 'general';
}

export function inferExperience(title, supplied = '') {
  const text = `${supplied} ${title}`.toLowerCase();
  if (/\b(intern|internship|apprentice)\b/.test(text)) return 'intern';
  if (/\b(staff|principal|lead|architect|director|manager|head of|distinguished)\b/.test(text)) return 'lead';
  if (/\b(senior|sr\.?|iii|iv)\b/.test(text)) return 'senior';
  if (/\b(junior|jr\.?|entry|graduate|new grad|associate|early career)\b/.test(text)) return 'entry';
  if (/\b(mid|intermediate|ii)\b/.test(text)) return 'mid';
  return 'unknown';
}

export function inferWorkplace(location = '', supplied = '', description = '') {
  const text = `${supplied} ${location}`.toLowerCase();
  if (/hybrid/.test(text)) return 'hybrid';
  // Some remote feeds contain roles whose description still requires office days.
  const prose = description.toLowerCase();
  if (/\b(?:this (?:role|position) is (?:a )?(?:hybrid|not remote)|hybrid (?:role|position|work (?:model|schedule))|(?:required|expected|must)\b[^.\n]{0,60}\b(?:in[- ]office|on[- ]site))/.test(prose)) return 'hybrid';
  if (/\b(?:not (?:a |an? entirely |a fully )?remote (?:role|position)|remote (?:work|working) is not (?:available|offered|allowed))/.test(prose)) return 'onsite';
  if (/(?:\b(?:\d+|one|two|three|four|five)\s+days?\s*(?:per|a|each|every|\/)\s*week\b[^.\n]{0,35}\boffice\b|\b(?:in|at) (?:the |our )?office\b[^.\n]{0,35}\b(?:\d+|one|two|three|four|five)\s+days?\s*(?:per|a|each|every|\/)\s*week)/.test(prose)) return 'hybrid';
  if (/on.?site|in.?office/.test(text)) return 'onsite';
  if (/remote|distributed|anywhere|worldwide/.test(text)) return 'remote';
  return 'unknown';
}

export const US_STATES = 'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming';
const US_PLACE = new RegExp(`\\b(?:${US_STATES}|San Francisco|San Jose|San Diego|Los Angeles|Seattle|Austin|Boston|Chicago|Denver|Atlanta|New York City|NYC|Washington DC)\\b`, 'i');
export function isUSLocation(location = '') {
  if (/\b(?:except|excluding|outside|not (?:in|available in|eligible in))\s+(?:the\s+)?(?:united states|u\.?s\.?a?\.?)\b/i.test(location)) return false;
  // CA also means Canada; "Toronto, Ontario, CA" is not California.
  if (!/\b(?:united states(?: of america)?|u\.?s\.?a?\.?)\b/i.test(location) && !US_PLACE.test(location)
    && /\b(?:Canada|Ontario|Quebec|British Columbia|Toronto|United Kingdom|England|India|Germany|Pakistan|Philippines|Australia|Singapore|Netherlands)\b/i.test(location)) return false;
  return /\b(united states(?: of america)?|u\.?s\.?a?\.?)\b/i.test(location)
    || US_PLACE.test(location)
    || /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/.test(location);
}

export function isUSRemoteJob(job) {
  return isUSLocation(job.location) && inferWorkplace(`${job.location} ${job.title || ''}`, job.workplace, job.description) === 'remote';
}

const YEAR_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const YEAR_NUMBER = `(?:\\d+(?:\\.\\d+)?|${Object.keys(YEAR_WORDS).join('|')})`;
const YEAR_PATTERN = new RegExp(`\\b(${YEAR_NUMBER})(?:\\s*\\(${YEAR_NUMBER}\\))?(?:\\s*(?:[-–—]|to)\\s*(${YEAR_NUMBER}))?\\s*(?:\\+|plus|or more)?\\s*[- ]?\\s*(?:years?|yrs?)\\b`, 'gi');
const OPTIONAL_HEADING = /^(?:preferred (?:qualifications|requirements|skills|experience)|nice[- ]to[- ]haves?|bonus(?: points| skills| qualifications)?|desired (?:qualifications|skills))\s*:?$/i;
const REQUIRED_HEADING = /^(?:(?:minimum |required |basic )?(?:qualifications|requirements|skills|experience)|what (?:you(?:'|’)ll (?:need|bring)|we(?:'|’)re looking for)|about you|your (?:qualifications|experience|expertise))\s*:?$/i;

export function extractExperienceRequirement(description = '') {
  const requirements = [];
  let optionalSection = false;
  // Read requirements, not company age, benefits, or preferred qualifications.
  for (const rawLine of plainText(description).split(/\n|(?<=[.!?])\s+(?=[A-Z])/)) {
    const line = rawLine.trim().replace(/^[•*#\s]+/, '');
    if (OPTIONAL_HEADING.test(line)) { optionalSection = true; continue; }
    if (line.length < 100 && REQUIRED_HEADING.test(line)) optionalSection = false;
    if (!optionalSection && /\bno (?:(?:prior|previous|professional|work) )*experience (?:is )?(?:required|necessary)\b/i.test(line)) {
      requirements.push({ minYears: 0, exclusive: false, evidence: line.slice(0, 400) });
    }
    YEAR_PATTERN.lastIndex = 0;
    const matches = [...line.matchAll(YEAR_PATTERN)];
    const lineRequirements = [];
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index];
      const before = line.slice(Math.max(matches[index - 1]?.index + matches[index - 1]?.[0].length || 0, match.index - 55), match.index);
      const after = line.slice(match.index + match[0].length, Math.min(matches[index + 1]?.index ?? line.length, match.index + match[0].length + 180));
      const clause = `${before}${match[0]}${after}`;
      const sharedDegreeExperience = /\b(?:bachelor|master|degree|ph\.?d)\b/i.test(line) && /\bor\b/i.test(line) && /\bexperience\b/i.test(line);
      const precedingExperience = /\b(?:experience|exp\.?)\s*(?::|of|is|at least|minimum(?: of)?|required)?\s*$/i.test(before);
      if (!sharedDegreeExperience && !precedingExperience && !/\b(?:experience|exp\.?|building|developing|programming|coding|designing|working|engineering|software development)\b/i.test(after)) continue;
      if (/\b(?:we|our company|our team|the company)\s+(?:has|have|bring|brings|with)|\b(?:combined|collective|founded|established|last|past)\s*$/i.test(before)) continue;
      if (/\b(?:preferred|preferably|ideally|nice[- ]to[- ]have|desirable|optional|a plus|a bonus)\b/i.test(clause)) continue;
      if (optionalSection && !/\b(?:required|must have|minimum|at least)\b/i.test(clause)) continue;
      const years = YEAR_WORDS[match[1].toLowerCase()] ?? Number(match[1]);
      if (!Number.isFinite(years) || years > 60) continue;
      lineRequirements.push({
        minYears: /\b(?:up to|at most|no more than)\s*$/i.test(before) ? 0 : years,
        exclusive: /\b(?:more than|over)\s*$/i.test(before),
        evidence: line.slice(0, 400),
      });
    }
    // Degree alternatives commonly allow fewer years with an advanced degree.
    if (lineRequirements.length > 1 && /\b(?:bachelor|master|degree|ph\.?d)\b/i.test(line) && /\bor\b/i.test(line)) {
      lineRequirements.sort((a, b) => a.minYears - b.minYears || Number(a.exclusive) - Number(b.exclusive));
      requirements.push(lineRequirements[0]);
    } else requirements.push(...lineRequirements);
  }
  requirements.sort((a, b) => b.minYears - a.minYears || Number(b.exclusive) - Number(a.exclusive));
  return requirements[0] ?? { minYears: null, exclusive: false, evidence: '' };
}

export function experienceRequirementFor(job) {
  // Reparse old saved jobs, which predate numeric experience requirements.
  return job.requiredExperience ?? extractExperienceRequirement(job.description);
}

export function salaryData(min, max, currency, period, label = '') {
  const low = Number(min) > 0 ? Number(min) : null;
  const high = Number(max) > 0 ? Number(max) : null;
  const normalizedPeriod = /^(annual|annually|year|yearly|per year)$/i.test(period ?? '') ? 'year'
    : /^(hour|hourly|per hour)$/i.test(period ?? '') ? 'hour'
    : /^(month|monthly)$/i.test(period ?? '') ? 'month' : null;
  return { min: low, max: high, currency: currency?.toUpperCase() || null, period: normalizedPeriod, text: plainText(label) };
}

export function parseSalary(value = '') {
  const text = plainText(value);
  const currency = /\bUSD\b|US\$/.test(text) ? 'USD' : /\bEUR\b|€/.test(text) ? 'EUR' : /\bGBP\b|£/.test(text) ? 'GBP' : null;
  // A bare $ may mean USD, CAD or AUD: retain the text without guessing.
  const amounts = [...text.matchAll(/(?:[$€£]|\b(?:USD|EUR|GBP)\s*)\s*([\d,]+(?:\.\d+)?)\s*(k)?/gi)]
    .map((match) => Number(match[1].replace(/,/g, '')) * (match[2] ? 1000 : 1));
  const period = /\b(hour|hourly|hr)\b|\/h\b/i.test(text) ? 'hour' : /\b(month|monthly)\b/i.test(text) ? 'month'
    : /\b(year|yearly|annual|annually|annum)\b/i.test(text) ? 'year' : null;
  return salaryData(amounts[0], amounts[1] ?? amounts[0], currency, period, text);
}

export function keywordMatches(text, keyword) {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !!escaped && new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
}

export function parseKeywords(value = '') {
  return [...new Set(value.split(/[,;\n]/).map((word) => word.trim()).filter(Boolean))].slice(0, 20);
}

export function matchedKeywords(job, keywords) {
  const haystack = `${job.title}\n${job.description}`;
  return keywords.filter((word) => keywordMatches(haystack, word));
}

export function annualUSD(salary) {
  // Do not silently convert currencies or annualize hourly/contract compensation.
  return salary?.currency === 'USD' && salary.period === 'year' ? salary.max ?? salary.min : null;
}

export function postingDateBounds(from = '', to = '') {
  const parse = (value) => {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : NaN;
  };
  const start = parse(from), end = parse(to);
  const valid = !Number.isNaN(Number(start)) && !Number.isNaN(Number(end)) && (!start || !end || start <= end);
  // Calendar days, including DST changes; the end date includes the entire day.
  if (end instanceof Date) end.setDate(end.getDate() + 1);
  return { valid, start: start?.getTime?.() ?? null, end: end?.getTime?.() ?? null };
}

export function filterJobs(jobs, filters, now = Date.now()) {
  const keywords = parseKeywords(filters.keywords);
  const dates = filters.days === 'custom' ? postingDateBounds(filters.dateFrom, filters.dateTo) : null;
  if (dates && !dates.valid) return [];
  const result = jobs.filter((job) => {
    // These are fixed search constraints; old browser settings cannot loosen them.
    if (!isUSRemoteJob(job) || !isSoftwareJob(job.title)) return false;
    if (filters.roleFocus && roleFamily(job.title) !== filters.roleFocus) return false;
    if (filters.location && !keywordMatches(job.location, filters.location.trim())) return false;
    if (filters.role && !`${job.title} ${job.company}`.toLowerCase().includes(filters.role.trim().toLowerCase())) return false;
    if (filters.experienceYears !== undefined && String(filters.experienceYears).trim() !== '') {
      const years = Number(filters.experienceYears);
      if (filters.experienceYears === '' || !Number.isFinite(years) || years < 0) return false;
      const requirement = experienceRequirementFor(job);
      if (years < 5 && ['senior', 'lead'].includes(inferExperience(job.title, job.experience === 'senior' || job.experience === 'lead' ? job.experience : ''))) return false;
      if (requirement.minYears === null ? !filters.includeUnknownExperience : requirement.exclusive ? years <= requirement.minYears : years < requirement.minYears) return false;
    }
    const posted = Date.parse(job.postedAt);
    if (dates && (dates.start !== null || dates.end !== null)) {
      if (!Number.isFinite(posted) || (dates.start !== null && posted < dates.start) || (dates.end !== null && posted >= dates.end)) return false;
    } else if (filters.days && filters.days !== 'custom' && (!Number.isFinite(posted) || now - posted > Number(filters.days) * 86400000 || posted > now + 300000)) return false;
    if (Array.isArray(filters.sources) && !filters.sources.includes(job.sourceId)) return false;
    const salary = annualUSD(job.salary);
    if (filters.salaryOnly && salary === null) return false;
    if (Number(filters.minSalary) > 0 && (salary === null ? !filters.includeUnknownSalary : salary < Number(filters.minSalary))) return false;
    if (keywords.length) {
      const matches = matchedKeywords(job, keywords).length;
      if (filters.keywordMode === 'any' ? matches === 0 : matches !== keywords.length) return false;
    }
    return true;
  });
  return result.sort((a, b) => {
    if (filters.sort === 'salary') return (annualUSD(b.salary) ?? -1) - (annualUSD(a.salary) ?? -1) || (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0);
    return (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0) || a.id.localeCompare(b.id);
  });
}

export function deduplicateJobs(jobs) {
  const seen = new Set(), urls = new Set();
  return jobs.filter((job) => {
    let canonical = '';
    try {
      const url = new URL(job.applyUrl);
      url.hash = '';
      url.hostname = url.hostname.replace(/^www\./, '');
      if (url.hostname === 'linkedin.com' && /\d+\/?$/.test(url.pathname)) url.pathname = `/jobs/view/${url.pathname.match(/(\d+)\/?$/)[1]}`;
      for (const param of [...url.searchParams.keys()]) if (/^(?:utm_|trk$|tracking|ref(?:id)?$|source$|gh_src$|lever-source$|lever-via$)/i.test(param)) url.searchParams.delete(param);
      url.searchParams.sort(); canonical = url.href.replace(/\/$/, '');
    } catch { /* Old saved jobs can lack an application URL. */ }
    // Collapse the same application syndicated in multiple cities or indexes.
    // Distinct openings with different URLs and locations remain separate.
    const clean = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    const key = `${clean(job.company)}|${clean(job.title)}|${clean(job.location)}`;
    if (seen.has(key) || (canonical && urls.has(canonical))) return false;
    seen.add(key);
    if (canonical) urls.add(canonical);
    return true;
  });
}
