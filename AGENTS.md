# Peacock Notes

## Releases

Release Please maintains the release PR from conventional commits on `main`. Use `fix:` for patch releases, `feat:` for minor releases, and `!` or `BREAKING CHANGE:` for major releases. Use these prefixes in squash merge titles too.

Release Please owns `.release-please-manifest.json`, version updates, and `CHANGELOG.md`. Let the release PR update them. The Expo strategy updates `package.json`, its lockfile, and `app.json`, including Android's version code. Extra-file updaters keep the Expo runtime version and Android runtime resource in sync. Android reads its version name and code from `app.json`.

Merge the release PR to create a `v<version>` tag and draft GitHub release. The Release Please workflow calls `.github/workflows/release.yml` to run recovery checks, build and verify the signed APK, attach it, and publish the release. Keep the release as a draft if the build fails. Retry the release workflow manually with the existing tag. Preserve the generated release notes during retries.

Read both release workflows and `release-please-config.json` before changing release behavior. Preserve the `peacocknotes-v<version>-<versionCode>.apk` name, package identity, and signing checks because the in-app updater depends on them. Manual tag releases still require matching patch notes or an existing GitHub release.

With the built-in GitHub token, enable "Allow GitHub Actions to create and approve pull requests" in repository Actions settings. Bot-created release PRs do not trigger pull-request CI automatically. Run Recovery checks manually on the release PR branch before merging, or configure the optional `RELEASE_PLEASE_TOKEN` secret with a token that can write contents and pull requests.

Validate release changes with actionlint, simulated Release Please version updates, `npm run typecheck`, and `npm test`. Run Android recovery checks when changing native behavior. Report any checks that could not run and the reason.
