---
name: review-plan
description: Review an implementation plan for unnecessary complexity, verify simpler alternatives against the codebase, and revise the plan in place so the implementation is smaller and fits the existing architecture. Does not implement.
disable-model-invocation: true
---

Review this implementation plan for unnecessary complexity:

<plan_request>
$ARGUMENTS
</plan_request>

Your goal is the smallest implementation that fully meets the plan's
requirements and fits the existing architecture. Every task, file, abstraction,
option, and branch of logic the plan prescribes must earn its place. Cut what
does not; simplify what remains.

You edit the plan. You do not implement it, and you do not change source, test,
or documentation files.

## Establish the starting state

Resolve the plan path from the arguments and conversation. If the reference is
empty or ambiguous, look for matching plans in `agents/plans/`; ask the user
only when more than one plausible match remains.

Read the entire plan, then the documents its tasks cite. Read
`.claude/agents/plan.md` so your revisions keep the required plan structure and
task template.

Separate what the plan must deliver from how it proposes to deliver it:

- **Requirements** — the summary, task objectives, and **Decisions made with
  the operator**. These are fixed. Do not cut or weaken them on your own.
- **Prescribed implementation** — design notes, touch points, new modules,
  helpers, options, and task breakdown. These are what you review.

Note each task's status. Do not rewrite completed or in-progress tasks; flag
problems in them for the user instead.

## Check the plan against the code

Read the code at every expected touch point, plus the nearest existing feature
that does something similar. A simplification is only real if the codebase
supports it, so confirm before proposing:

- Which existing Collections, transaction scripts, forms, handlers, helpers,
  templates, and plugin ports the plan could reuse instead of adding new ones.
- How the nearest similar feature is structured, so the plan can follow it
  rather than invent a new pattern.
- Whether a case the plan defends against can actually occur.

Use the Explore agent for broad searches; read files directly for targeted
lookups.

## What to look for

**Logic that can be removed**

- Requirements the plan invents: features, options, settings, or flags that no
  requirement or operator decision asks for.
- Speculative generality (building for imagined future needs): extension
  points, plugin hooks, generic base classes, or configuration with only one
  real use.
- Handling for states that cannot happen. Programmer errors should fail with an
  `assert*` check, not a recovery path.
- Validation repeated at several layers when one boundary already enforces it.
- Backward-compatibility shims, fallbacks, or migrations for data or code that
  has never shipped.
- Caching, batching, or other performance work without a stated, measured need.
- Tests that re-test framework or vendored code, or duplicate coverage another
  task already provides.

**Logic that can be simpler**

- New modules, classes, or helpers with a single caller. Inline them.
- Layers of indirection (wrappers that only forward a call, adapters between
  two of our own modules).
- Re-implementations of something that already exists, or a vendored dependency.
- New patterns where the project already has one: data access outside
  Collections, domain logic outside transaction scripts, platform differences
  outside plugins, new CSS outside the style guide's components. Follow the
  doc index to the governing guide.
- State stored when it could be derived, or derived data kept in sync by hand.
- A new dependency, when existing code covers the need. Never add one; this
  project requires the user to approve dependencies.

**Plan structure**

- Tasks that exist only to build scaffolding a later task could add in place.
- Tasks that can merge once their removed logic is gone. Keep each task within
  the Implementation agent's ~250k token budget.
- Dependencies that are no longer needed after a cut.

## What not to cut

Simpler must still be correct. Keep:

- Every requirement and operator decision, and the reason recorded for it.
- Security controls: authentication, permission checks, CSRF protection, and
  input validation at trust boundaries.
- Required failure behavior, data integrity, and concurrency handling the
  requirements depend on.
- Documentation and tests that cover behavior the plan adds.
- Operator runbook steps, such as migrations and deployment order.

When a cut changes observable behavior or scope, it is a product decision.
Do not make it. Propose it to the user with your recommendation and the
tradeoff, preferring the AskUserQuestion tool for distinct choices.

## Revise the plan

Edit the plan in place. For each change:

- Update the affected task's **Design and invariants**, **Expected touch
  points**, **Acceptance criteria**, and **Validation** so they stay consistent
  with each other.
- Name the existing code to reuse, with its file path, so the implementing
  agent does not rediscover it.
- Record the simplification as a design constraint when a later agent might
  otherwise re-add the removed logic (for example, "Do not add a retry here;
  the Collection's update retry already covers it").
- Keep stable task IDs. When you remove or merge a task, update every
  **Depends on** field that referenced it.

Do not reformat or reword parts of the plan you did not change.

## Report

Finish with:

- The plan's file path.
- The changes you made, each with a one-line reason and the code that
  justified it.
- Proposed cuts awaiting a user decision.
- Problems found in completed or in-progress tasks.

If you found nothing worth changing, say so. Do not make changes to appear
useful.
