---
name: new-feature
description: Clarify a new feature request, explore the codebase, and produce a reviewed implementation plan using Explore and Plan subagents. Stops before implementation.
---

Work with the user to plan a new feature or addition:

<user_request>
$ARGUMENTS
</user_request>

If the request above is empty, ask the user what they want to build before doing anything else.

You own user communication, requirements, delegation, and final review. Use the
custom Explore and Plan agents defined in `.claude/agents/explore.md` and
`.claude/agents/plan.md`. Read `plan.md` before delegating; it defines the
required plan structure and task template you will review against.

## Clarify and explore

Ask Explore specific codebase questions, supplying the feature request, relevant
paths, and an appropriate search breadth. Send independent questions to separate
Explore agents in parallel. Request a summary with file references, existing
patterns to reuse, affected interfaces, constraints, and uncertainties. Look up
codebase facts rather than asking the user to supply them.

Check `agents/plans/` for existing plans that overlap with or constrain the
request.

Establish the intended outcome, users and workflows, scope and exclusions, and
observable success and failure behavior. Ask focused questions for information
that cannot be inferred from the request or exploration. Prefer the
AskUserQuestion tool for choices with distinct options, listing your
recommended option first. Continue independent exploration while waiting.

Resolve routine implementation choices using existing conventions and record
material assumptions. Ask the user about unresolved product behavior, scope, or
consequential tradeoffs, such as compatibility, permissions, or data loss. Do not
treat missing answers as agreement. Reuse decisions already confirmed in the
conversation instead of asking again.

Summarize the requirements and material decisions, with the reason for each,
and obtain the user's confirmation of the shared understanding before
commissioning the written plan. An existing explicit confirmation suffices if
the scope has not changed.

## Delegate planning

Give the Plan agent the confirmed requirements, scope and exclusions, decisions
and their reasons, assumptions, Explore findings with file references, applicable
documentation, and related plans. Specify a descriptive destination such as
`agents/plans/<feature-name>.md`; update a related plan when appropriate rather
than overwriting unrelated work.

Tell Plan that you own user communication. It must route questions and proposed
requirement changes to you, distinguishing questions requiring user input from
choices it can recommend from project conventions. Answer from the confirmed
requirements or investigate further; bring unresolved consequential choices to
the user.

Continue the same Plan agent with SendMessage to relay answers, new decisions,
and review feedback. Starting a new Plan agent discards its exploration and
context.

Request a saved implementation plan using its prescribed structure, plus the
file path, a brief approach summary, and any unresolved questions or blockers.
The plan must preserve the requirements and decisions needed by an implementing
agent with no conversation history.

## Review and deliver

Read the saved plan yourself. Check that it:

- Covers the confirmed requirements, scope, exclusions, and material assumptions.
- Records each decision made with the user, and its reason, under
  **Decisions made with the operator**, so an implementing agent does not
  reverse a business requirement as a style preference.
- Uses existing patterns and respects applicable project constraints.
- Partitions work into coherent tasks with stable IDs, clear ownership, and
  valid dependencies, without gaps or circular dependencies.
- Sizes each task so the Implementation agent can complete and validate it
  within about 250k tokens.
- Defines observable acceptance criteria and practical validation, including
  relevant failure behavior, documentation, and rollout or migration steps.
- Uses exact, runnable validation commands (`node lib/run-tests.js <path>`,
  `node lib/run-linter.js <path>`, or the `devkit/` equivalents), and explains how to run manual checks.
- Puts steps an agent cannot perform in an operator checklist, not in agent
  validation steps.
- Records consequential decisions and makes unresolved questions explicit.

Send gaps or contradictions back to Plan for revision and review the revised
artifact. If a required answer is unavailable, preserve the draft with explicit
blockers and tell the user what is needed; do not call it ready for implementation.

Finish by linking the saved plan and briefly summarizing the approach, the task
list, and any remaining blockers. Tell the user that implementation starts by
running the Implementation agent with the plan's path. Planning is complete
when the artifact passes review and no required decisions remain unresolved.
Do not begin implementation or deployment.
