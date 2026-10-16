import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { compileFunction } from 'node:vm';

const require = createRequire(import.meta.url);
let client;

// Compatibility fixes for the exact locked release. Execute the installed CJS
// bundle with its normal module resolution; do not modify node_modules, write a
// generated module, or evaluate any code obtained from job postings.
export function preserveIndeedEvidence(source) {
  const changes = [
    ['post.datePosted.toISOString().split("T")[0]', 'post.datePosted.toISOString()'],
    ['const timestampSeconds = job.datePublished / 1e3;', 'const timestampSeconds = (job.dateOnIndeed ?? job.datePublished) / 1e3;'],
    ['emails: extractEmailsFromText(description),\n      isRemote: isJobRemote2(', 'emails: extractEmailsFromText(description),\n      originalPostedAt: new Date(job.datePublished).toISOString(),\n      workplaceEvidence: job.attributes.some(a => a.key === "DSQF7") && !job.attributes.some(a => a.key === "PAXZC") ? "indeed_remote" : null,\n      isRemote: isJobRemote2('],
    ['isRemote: post.isRemote ?? null,', 'isRemote: post.isRemote ?? null,\n    originalPostedAt: post.originalPostedAt ?? null,\n    workplaceEvidence: post.workplaceEvidence ?? null,'],
  ];
  let output = source.replace(/\r\n/g, '\n');
  for (const [from, to] of changes) {
    if (output.split(from).length !== 2) throw new Error('The installed job-search library is incompatible. Run npm ci with the committed lockfile.');
    output = output.replace(from, to);
  }
  return output;
}

export async function preciseScrapeJobs(options) {
  if (!client) client = (async () => {
    const filename = require.resolve('ts-jobspy');
    const metadata = JSON.parse(await readFile(require.resolve('ts-jobspy/package.json'), 'utf8'));
    if (metadata.version !== '3.0.1') throw new Error('The timestamp adapter requires the locked ts-jobspy 3.0.1 release. Run npm ci.');
    const source = preserveIndeedEvidence(await readFile(filename, 'utf8'));
    const module = { exports: {} };
    compileFunction(source, ['exports', 'require', 'module', '__filename', '__dirname'], { filename })(module.exports, createRequire(filename), module, filename, dirname(filename));
    return module.exports.scrapeJobs;
  })();
  return (await client)(options);
}
