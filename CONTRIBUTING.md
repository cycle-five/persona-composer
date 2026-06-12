# Contributing

Even though this is currently a solo project, work flows through a lightweight
branch → PR → merge cadence. It keeps `master` reviewable, guarantees a remote
copy of every change, and keeps the habits sharp for when the project grows.

## The cadence

1. **Branch** off an up-to-date `master`:
   ```sh
   git switch master && git pull
   git switch -c <type>/<short-slug>
   ```
2. **Commit** focused, well-described changes (see message style below).
3. **Push** the branch and **open a PR**:
   ```sh
   git push -u origin HEAD
   gh pr create --fill         # or --web to draft in the browser
   ```
4. **Review** — read the diff on the PR, leave comments, run CI/checks.
5. **Iterate** — push follow-up commits to the same branch until it's right.
6. **Merge** with **squash** (project default), then delete the branch:
   ```sh
   gh pr merge --squash --delete-branch
   ```
   `master` only ever advances through a merged PR.

## Branch naming

`<type>/<short-slug>`, where `<type>` is one of:

| type     | for                                  |
| -------- | ------------------------------------ |
| `feat`   | new functionality                    |
| `fix`    | bug fixes                            |
| `docs`   | documentation only                   |
| `chore`  | tooling, deps, repo hygiene          |
| `refactor` | behavior-preserving restructuring  |

e.g. `feat/phase-2-mv3-extension`, `fix/sse-buffer-flush`, `docs/contributing-workflow`.

## Commit messages

- Imperative subject line, ≤ ~72 chars (`feat: stream compose drafts over SSE`).
- A body explaining the *why* when the change isn't self-evident.
- Each commit should build and typecheck on its own (`npm run typecheck`).

## Before opening a PR

```sh
npm run typecheck   # tsc --noEmit, must be clean
npm run build       # tsc → dist/
```

## Merge strategy

**Squash** is the default: each PR lands as a single, well-described commit, so
`master` stays linear and reads as one commit per feature. The branch's
intermediate "wip" commits don't pollute history.

> Repo-level default to match this (set once by a maintainer):
> ```sh
> gh api -X PATCH repos/cycle-five/persona-composer \
>   -F allow_squash_merge=true \
>   -F allow_merge_commit=false \
>   -F allow_rebase_merge=false \
>   -F delete_branch_on_merge=true
> ```
