# comm-unified-l10n

A minimal mirror of hg.mozilla.org/comm-unified used for localization cross-channel.

* https://hg.mozilla.org/comm-unified --> https://github.com/thunderbird/comm-unified-l10n

The action code is designed with Mercurial repositories such as Mozilla's
[mozilla-unified](https://hg.mozilla.org/mozilla-unified) and
[comm-unified](https://hg.mozilla.org/comm-unified) in mind as they publish the necessary
bookmarks.

The only supported use of the action code in this repository is the temporary
mirroring of comm-unified to Github.

# Description

The one-way mirror is performed by a Github action under .github/actions/mirror-hgmo.
It is a composite action that assumes [git-cinnabar](https://github.com/glandium/git-cinnabar)
is configured and ready to use. **Version 0.7 is needed for comm-unified!**

The action is triggered in the main workflow (.github/workflows/main.yml) either
manually or by cron scheduling.

git-cinnabar is configured to use "bookmark" mode.

Since the mirroring is done back to the same repository, access is controlled
by Github's automatic token authentication using GITHUB_TOKEN. No specific
setup is needed.


## Action Inputs

* source-hg-repo-url: **Required** The clone URL of a Mercurial (hg) repository.
* source-hg-bookmarks: **Required** Space separated list of Mercurial bookmarks
  to mirror as Git branches
* force-push: Run `git push` command with the `--force` flag. (default: *false*)

## Example Usage

See [the workflow file](.github/workflows/main.yml).
