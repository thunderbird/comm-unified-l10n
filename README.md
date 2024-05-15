# job-mirror-unified

A job to mirror hg repos via github action.

* https://hg.mozilla.org/comm-unified --> https://github.com/thunderbird/l10n-comm-unified

The action code is designed with Mercurial repositories such as Mozilla's
[mozilla-unified](https://hg.mozilla.org/mozilla-unified) and
[comm-unified](https://hg.mozilla.org/comm-unified) in mind as they publish the necessary
bookmarks.

The only supported use of the action code in this repository is the temporary
mirroring of comm-unified to Github.

# Description

This project sets up a Github action under .github/actions/mirror-hgmo. The
source code is under actions/mirror-hgmo, and was originally forked from
[mirror-hg-repo](https://github.com/mozillazg/mirror-hg-repo).

The action is triggered in the main workflow (.github/workflows/main.yml) either
manually or by cron scheduling.

Like the original action, Mark Nauwelaerts' fork of git-remote-hg is used for
the actual mirroring. It is simply included in this repository from
https://github.com/mnauw/git-remote-hg rather than utilizing the copy used
by upstream.

Like the original, a Github Personal Token with push access to the Github 
destination repository is needed.

This project also caches the working copy that it creates using `actions/cache`.

## Action Inputs

* source-hg-repo-url: **Required** The clone URL of a Mercurial (hg) repository.
* source-hg-bookmarks: **Required** Space separated list of Mercurial bookmarks
  to mirror as Git branches
* destination-git-repo-owner: **Required** The owner of Github repository
* destination-git-repo-name: **Required** The name of the Github repository
* force-push: Run `git push` command with the `--force` flag. (default: *false*)
* path: Path for repo clone (relative to $GITHUB_WORKSPACE)

## Example Usage

See [the workflow file](.github/workflows/main.yml).
