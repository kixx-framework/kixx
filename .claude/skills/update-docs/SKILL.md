---
name: update-docs
description: Audit the project's documentation, Claude skills, and agent definitions against the current codebase, fix inaccurate or stale content, and trim bloat. Optionally scoped to specific paths or to changes since a git ref.
argument-hint: "[paths... | since <git-ref>]"
disable-model-invocation: true
---

Audit and update the documentation so it matches the code and stays lean.

<scope>
$ARGUMENTS
</scope>

If the scope is empty, audit everything listed under **Inventory**. If it names
paths, audit only those, plus any index entries that describe them. If it says
`since <git-ref>`, audit only docs affected by `git diff <git-ref>...HEAD`.

## Ground rules

- **The code is the source of truth.** When a doc and the code disagree, fix the
  doc. If the code looks like the bug (it contradicts a documented contract,
  a security rule, or a decision recorded in `agents/plans/`), leave both alone
  and report it.
- **Edit docs only.** Do not change source code, tests, or config.
- **Skip vendored dependencies.** Vendored docs belong to third-party packages.
- **Do not rewrite history.** Leave `agents/journal/` and `agents/plans/` as
  they are; plans are only checked for the decisions they record.
- **Read-only commands only.** Running `--help` or reading a file is fine.
  Anything that deploys, publishes, or writes to the Publishing or Admin API is
  not.
- **Keep load-bearing content.** Never cut permission rules, security or data
  loss warnings, failure recovery steps, or the reasoning behind a
  non-obvious rule.

## Inventory

Agent-facing:

- `CLAUDE.md`, `agents/docs/doc-index.md`, `agents/docs/file-structure.md`
- `.claude/agents/*.md`, `.claude/skills/*/SKILL.md` (and files they reference),
  `.claude/output-styles/`

Developer and operator guides:

- `README.md`, `docs/*.md`, `lib/docs/*.md`
- `lib/app/*/README.md`, `lib/plugins/README.md`, `lib/templates/README.md`
- `app/pages/admin/style-guide/` (the live design system)

Kixx framework: `lib/kixx/**/*.md`, except `lib/kixx/vendor/`.

## 1. Find what changed

Find where to focus before reading everything:

```bash
git log -1 --format=%H -- <doc>            # last commit that touched a doc
git log --oneline <that-commit>..HEAD -- src tools test package.json
```

Code that changed after a doc was last edited is where it most likely went
stale. Also look for things that have no doc yet: new routes in `lib/routes/`,
transaction scripts, collections, plugins, framework modules in `lib/kixx/`,
npm scripts, env vars in `src/example.env*`,
and new top-level entries in `src/`.

## 2. Verify claims

Check every concrete, testable claim in each doc:

- File and directory paths exist (`git ls-files`, `ls`).
- Commands, flags, and npm scripts exist (`package.json`, `--help` output).
- Class, function, export, route, binding, and config key names match the code.
- Env vars match `lib/example.env`, `lib/example.env.secrets`,
  `lib/node-config.js`, and `lib/cloudflare-config.js`.
- Described behavior (defaults, limits, error codes, ordering) matches the
  implementation.
- Code examples would still run against the current API.

For a full audit, give independent doc groups to parallel Explore agents
(`.claude/agents/explore.md`, "medium" breadth). Give each one the doc paths and
ask for a list of claims that are wrong or unverifiable, with file:line
evidence from the code. You make the decisions and edits yourself, so the
voice stays consistent and you can resolve conflicts between findings.

## 3. Check cross-document consistency

- `agents/docs/doc-index.md` has one accurate summary per indexed doc. Add
  entries for new docs and remove entries for deleted ones. Summaries say what
  a doc covers, so an agent can decide whether to read it.
- `agents/docs/file-structure.md` matches `ls -A` at the root and in `src/`.
- `CLAUDE.md` and `README.md` do not contradict each other. Each fact lives in
  one place, and the other points to it.
- Each skill's `description` matches what the skill does and names the
  requests that should trigger it. Each agent's tool list and instructions
  still fit its job.
- Every path or doc that a skill or agent tells the reader to open still
  exists.

## 4. Trim

Agents load these files into context, so every line costs something. Cut:

- Restatements of what the code or another doc already says. Link to it
  instead.
- History ("previously…", "we changed…"). That belongs in git and the journal.
- Generic advice an agent already follows without being told.
- Filler, hedging, and repeated examples.

Do not restructure a doc that is accurate and already concise; small, focused
edits are easier to review.

## 5. Finish

1. Add an entry to today's journal in `agents/journal/`, as `CLAUDE.md`
   requires.
2. Commit your changes as you work, including any journal entries.
3. Report to the user, briefly:
   - Fixes, grouped by file, each with the code evidence behind it.
   - Cuts and other significant rewrites.
   - Framework doc edits (`src/kixx/`) listed separately, since they can
     conflict with upstream pull requests adopted later.
   - Items you did not change: suspected code bugs, missing docs that need a
     decision about where they belong, and claims you could not verify.
