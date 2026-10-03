# Peacock Notes

Peacock Notes is a simple, local-first notes app. Create a folder, write a note, and keep related audio, images, and PDFs together without a complicated workflow. Notes stay on your device by default, with optional Google Drive backups.

## Features

- Create, rename, delete, search, sort, and manually reorder folders and notes.
- Write notes with automatic saving when you leave the editor.
- Record, pause, resume, append, play, rename, and share audio attachments.
- Add images and PDFs, view images in the app, open PDFs with an installed reader, and share individual files.
- Share audio, images, or PDFs from another app directly into an existing note.
- Copy or share note text.
- View a breakdown of app storage used by notes, audio, attachments, the database, and other files.
- Use the app in English or Bengali, with light and dark themes.
- Back up to Google Drive with verified exports, automatic backups, archive health checks, selective or additive recovery, full replacement with a seven-day undo window, and managed retention.

## Feedback

Peacock Notes is still growing. Please [open an issue](../../issues/new) with bugs, feedback, or ideas for future updates. Tell us what feels easy to use and what could be simpler.

## Release automation

Merging a pull request into `main` runs Release Please. Conventional commit titles determine the next version: `fix:` bumps the patch, `feat:` bumps the minor, and `!` or `BREAKING CHANGE:` bumps the major. Documentation and maintenance changes do not trigger a release by themselves.

Release Please opens or updates a release PR with the version and generated changelog. Merge that PR to create a `v<version>` tag and draft GitHub release. The APK workflow then runs checks, builds the signed APK, verifies its identity, uploads it, and publishes the release. A failed build leaves a draft. Retry the APK workflow with the same tag after resolving the failure.

The workflow uses the built-in GitHub token. Enable "Allow GitHub Actions to create and approve pull requests" in Settings > Actions > General. Run CI manually on bot-created release PRs before merging, or add a `RELEASE_PLEASE_TOKEN` Actions secret with a token that can write contents and pull requests so those PRs trigger CI automatically. Release builds also run checks before publication. Existing Android signing secrets are reused.

See [AGENTS.md](AGENTS.md) for version sources, APK naming, and release validation.
