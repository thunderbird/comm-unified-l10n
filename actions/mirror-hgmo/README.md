# mirror-hgmo

A GitHub Action to mirror hgmo repository to GitHub. Hacked up soft fork of
[mirror-hg-repo](https://github.com/mozillazg/mirror-hg-repo)

## Requirements

- actions/setup-python@v5
  - Needed to make Mercurial work
- shimataro/ssh-key-action@v2
  - Sets up an ssh key so the destination repo can be pushed to.
  - Add your SSH key to your product secrets by clicking 
    Settings - Secrets - Add a new secret beforehand.

## Example Usage

```yaml
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install SSH deploy key
        uses: shimataro/ssh-key-action@v2
        with:
          key: ${{ secrets.SSH_KEY }}
          name: id_ed25519

      - name: mirror https://hg.mozilla.org/comm-unified
        uses: '.github/actions/mirror-hgmo'
        with:
          source-hg-repo-url: 'https://hg.mozilla.org/comm-unified'
          source-hg-bookmarks: 'comm comm-beta comm-release'
          destination-git-repo-owner: 'jfx2006'
          destination-git-repo-name: 'comm-unified'
```

## Inputs

* `source-hg-repo-url`: (**Required**) The clone URL of a hgmo repository.
* `source-hg-bookmarks`: Remote bookmarks to mirror. If not set, just mirror `default`.
* `destination-git-repo-owner`: (**Required**) The owner of Github repository.
* `destination-git-repo-name`: (**Required**) The name of Github repository.
* `force-push`: (Optional) Run `git push` action with the `--force` flag. The default value is: `false`

