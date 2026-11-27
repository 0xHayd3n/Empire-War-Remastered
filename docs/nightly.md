# Nightly

`nightly` is the default branch of **this fork** and the branch to use for Universal development. It includes unfinished source and experiments, not just release candidates. [`remastered`](https://github.com/0xHayd3n/Empire-War-Remastered/tree/remastered) remains the earlier checkpoint; the sibling classic edition is not the Nightly upload source.

## Incoming Browser Edition changes

[Sync Browser Edition into Nightly](https://github.com/0xHayd3n/Empire-War-Remastered/actions/workflows/sync-browser-edition.yml) fetches `Glenn332/Empire-At-War-Browser-Edition:main` every six hours, or on **Run workflow → nightly**. It tries an ordinary Git merge, runs `npm ci` and `npm run check:nightly` on the combined tree without retail data, and fast-forwards the public branch to a two-parent merge commit only if both tips and the tested tree still match. This retains both projects’ histories. The job does not rebase, force-push, change upstream, deploy a server, or download game data.

On a conflict, failed check, or sensitive workflow/publisher/hosting change, the job leaves Nightly untouched and reports the reason in Actions. It does **not** resolve conflicts by always preferring one project. To reconcile locally, fetch upstream, branch from current `origin/nightly`, merge `upstream/main`, resolve the affected systems, run the same checks and mounted gameplay checks, then submit a PR to `nightly`. For someone who just cloned the fork:

```sh
git remote add upstream https://github.com/Glenn332/Empire-At-War-Browser-Edition.git
git fetch --no-tags upstream main
git rev-list --left-right --count HEAD...upstream/main
```

The first number is fork-only commits and is expected to be nonzero. The second counts upstream commits not yet merged. A scheduled check is not a guarantee that the second number is always zero. [Compare current branches](https://github.com/0xHayd3n/Empire-War-Remastered/compare/nightly...Glenn332:Empire-At-War-Browser-Edition:main).
