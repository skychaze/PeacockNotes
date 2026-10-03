import { registerVersioningStrategy } from 'release-please';
import type { ConventionalCommit } from 'release-please';
import { DefaultVersioningStrategy } from 'release-please/build/src/versioning-strategies/default.js';
import type { Version } from 'release-please/build/src/version.js';

export class AppVersioningStrategy extends DefaultVersioningStrategy {
  override determineReleaseType(version: Version, commits: ConventionalCommit[]) {
    return super.determineReleaseType(version, commits.map(commit => ({
      ...commit,
      type: commit.breaking ? 'feat' : 'fix',
      breaking: commit.type === 'feat' && commit.scope === 'major',
    })));
  }
}

registerVersioningStrategy('app', () => new AppVersioningStrategy());
