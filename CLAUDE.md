@README.md

---

Kixx Library
------------

Notes for agents when working on the Kixx Library (usually referred to as just "Kixx"):

Before working on source code in `lib/`, read the documentation index at `lib/docs/doc-index.md`. It lists every guide and reference for the Kixx Library with a summary of each. Use it to find and read the docs relevant to your task.

Commit Messages
---------------

When you write a commit message, follow these rules:

- Separate the subject line from the body with a single blank line.
- Limit the subject line to 50 characters (72 is the absolute hard limit).
- Capitalize the first letter of the subject line.
- Do not end the subject line with a period.
- Use the imperative mood in the subject line (e.g., "Fix bug," "Add feature," not "Fixed" or "Adds"). Test formula: It must complete the sentence: "If applied, this commit will [your subject line here]".
- Wrap the body text manually at 72 characters to prevent Git formatting issues.
- Use the body to explain what and why vs. how. Assume the code explains the how; the message must explain the context and reasoning.

Temporary Scratchpad
--------------------

Use the `tmp/` directory as a temporary scratchpad to:

- Download assets to disk
- Write temporary Python, Bash, or Node.js scripts
- Jot down ephemeral notes or anything you might want to persist for later.

Don't worry about cleaning up the `tmp/` directory. We periodically sweep it to clear out old files and sub-directories when it is not in use.

Journal
-------

Keep a timestamped journal of your activity in `agents/journal/`. The journal should have one file per day, formatted as `YYYY-MM-DD.md`, and each entry should have a complete ISO timestamp including the date, and time, down to the minute, in the America/New_York (eastern) time zone.

When commiting your changes, be sure to commit the journal updates with them.

Helpful Tips
------------

When writing something intended for human consumption, (comment, commit message, reply to prompt) use as few words as possible. Get to the point. Less is more.

Let the reader of the code breathe. Add empty lines between logical blocks of code.
