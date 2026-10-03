import { appendFileSync } from 'node:fs';
import { GitHub, Manifest } from 'release-please';
import './versioning.ts';

const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const token = process.env.GH_TOKEN;
const output = process.env.GITHUB_OUTPUT;
if (!owner || !repo || !token || !output) {
  throw new Error('GITHUB_REPOSITORY, GH_TOKEN and GITHUB_OUTPUT are required');
}

const github = await GitHub.create({ owner, repo, token });
const manifest = await Manifest.fromManifest(github, 'main');
const release = (await manifest.createReleases()).find(result => result?.path === '.');
const prs = (await manifest.createPullRequests()).filter(result => result !== undefined);
appendFileSync(output, [
  `release_created=${Boolean(release)}`,
  `tag_name=${release?.tagName ?? ''}`,
  `prs_created=${prs.length > 0}`,
  `pr=${prs[0] ? JSON.stringify(prs[0]) : ''}`,
  '',
].join('\n'));
