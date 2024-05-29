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
The source code is under actions/mirror-hgmo, and was originally forked from
[mirror-hg-repo](https://github.com/mozillazg/mirror-hg-repo). The action code is
in the `main` branch, and it pushes to separate Git branches named after their
respective hgmo repositories.

The action is triggered in the main workflow (.github/workflows/main.yml) either
manually or by cron scheduling.

Like the original action, Mark Nauwelaerts' fork of git-remote-hg is used for
the actual mirroring. It is simply included in this repository from
https://github.com/mnauw/git-remote-hg rather than utilizing the copy used
by upstream.

Since the mirroring is done back to the same repository, access is controlled
by Github's automatic token authentication using ${{ secrets.GITHUB_TOKEN }}. 
Set GH_TOKEN in the job environment.

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
