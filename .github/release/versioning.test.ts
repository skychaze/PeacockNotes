import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppVersioningStrategy } from './versioning.ts';
import { parseConventionalCommits } from 'release-please/build/src/commit.js';
import { Version } from 'release-please/build/src/version.js';

const cases = [
  ['fix: repair saving', '1.2.4'],
  ['feat: add export', '1.2.4'],
  ['feat!: replace storage', '1.3.0'],
  ['fix!: change backup format', '1.3.0'],
  ['feat: replace storage\n\nBREAKING CHANGE: old backups need migration', '1.3.0'],
  ['feat(major): launch a complete new version', '2.0.0'],
] as const;

for (const [message, expected] of cases) {
  test(message, () => {
    const commits = parseConventionalCommits([{ sha: 'abc', message }]);
    assert.equal(new AppVersioningStrategy().bump(Version.parse('1.2.3'), commits).toString(), expected);
    assert.equal(commits[0].type, message.startsWith('fix') ? 'fix' : 'feat');
  });
}

test('the largest requested bump wins across merged changes', () => {
  const commits = parseConventionalCommits(cases.map(([message], index) => ({ sha: String(index), message })));
  assert.equal(new AppVersioningStrategy().bump(Version.parse('1.2.3'), commits).toString(), '2.0.0');
});


test('maintenance changes produce no release PR and features keep their changelog category', async () => {
  const { GitHub } = await import('release-please');
  const { Simple } = await import('release-please/build/src/strategies/simple.js');
  const { TagName } = await import('release-please/build/src/util/tag-name.js');
  const github = await GitHub.create({ owner: 'test', repo: 'app', defaultBranch: 'main', token: 'test' });
  const strategy = new Simple({ github, targetBranch: 'main', versioningStrategy: new AppVersioningStrategy() });
  const latest = { tag: new TagName(Version.parse('1.2.3')), sha: 'previous', notes: '' };
  for (const type of ['ci', 'chore', 'docs']) {
    const commits = parseConventionalCommits([{ sha: 'abc', message: `${type}: update automation` }]);
    assert.equal(await strategy.buildReleasePullRequest(commits, latest), undefined);
  }
  const commits = parseConventionalCommits([{ sha: 'abc', message: 'feat: add export' }]);
  const pr = await strategy.buildReleasePullRequest(commits, latest);
  assert.equal(pr?.version?.toString(), '1.2.4');
  assert.match(pr?.body.toString() ?? '', /Features/);
  assert.match(pr?.body.toString() ?? '', /add export/);
});
