Kixx Devkit Commands
====================

How the CLI in `devkit/kixx.js` discovers, configures, and runs commands, and what you
need to write to add a new one.


Command Structure
-----------------

Every invocation names two things:

```
kixx <command> <subcommand> [options] <...args>
```

The first argument is a **command**: a directory under `commands/`. The second
is a **sub-command**: a `.js` module inside that directory. A command exists
only once it is imported: each sub-command module is imported by its command's
`index.js`, and each `index.js` is imported by `commands/index.js`.

```
commands/
    index.js                  <- command name -> command index module
    admin/
        index.js              <- command description and sub-command map
        gen-secure-token.js   <- sub-command implementation
    cloudflare/
        index.js
        create-worker.js
```

`kixx.js` passes the map from `commands/index.js` to
`lib/command-registry.js`, which lists and resolves commands from it. The CLI
never reads the `commands/` directory. Static imports keep every command in the
module graph, which is what lets the CLI run when installed from JSR, where
there is no local directory to read.


The Command Index Module
------------------------

`index.js` exports `description` (used when listing top level commands) and
`subcommands`, a map from sub-command name to sub-command class. The key must
equal the module's file basename:

```js
import GenSecretTokenCommand from './gen-secure-token.js';

export const description = 'Application administration tools';

export const subcommands = {
    'gen-secure-token': GenSecretTokenCommand,
};
```

Sub-commands list in help in the map's declaration order. Top level commands
list alphabetically.

A sub-command module must not import its command's `index.js`: `index.js`
imports the module, so the cycle would leave the class's statics evaluating
against an uninitialized binding.

`devkit/test/commands/index.test.js` fails when a `.js` file in a command
directory is missing from its map, a command directory is missing from
`commands/index.js`, or a sub-command declares a reserved flag (`--help`,
`--version`, `-h`, `-v`).


The Sub-command Module
----------------------

A sub-command module default-exports a class. Static properties declare
everything the runner needs to know *before* constructing it — help text,
argument parsing rules, and required settings — so a command never runs
partially configured.

```js
import process from 'node:process';
import { generateSecretToken } from '../../lib/crypto.js';

export default class GenSecretTokenCommand {

    static description = `
        Generate a 256-bit secure token encoded as lowercase hexadecimal
        text, suitable for things like the ADMIN_BOOTSTRAP_TOKEN
    `;

    static options = {
        prefix: {
            type: 'string',
            short: 'p',
            description: 'Optional literal prefix prepended to the random token body',
        },
    };

    #output;

    constructor(args) {
        const { output = process.stdout } = args ?? {};
        this.#output = output;
    }

    run(options) {
        const token = generateSecretToken(options.prefix);
        this.#output.write(`${ token }\n`);
        return 0;
    }
}
```

### Static properties

**`description`** — Sentence or paragraph shown by `--help` and in the parent
command's sub-command list. Required. Descriptions are re-wrapped to the help
line width, so the indentation of a template literal is irrelevant.

**`options`** — Passed straight to `node:util` `parseArgs` as its `options`
config, so `type` (`'string'` or `'boolean'`), `short`, `multiple`, and
`default` all behave as documented there. The extra `description` key is used
only for help rendering. `--help` is added automatically; do not declare it.
Negated boolean flags (`--no-foo`) are enabled for command options.

**No `positionals`.** The runner owns the only positional argument, the
optional app directory, and uses it to find the project. Take every other
value as an option. A unit test rejects a `positionals` declaration.

**`requiredConfig`** — Dotted key paths which must be present in the merged
`.kixx/config.json` layers.

**`requiredSecrets`** — Dotted key paths which must be present in the merged
`.kixx/secrets.json` layers.

There is no `requiredCloudflareConfig`. Commands validate the parts of
`cloudflare-config.jsonc` they use, because most settings live under
`environments.<env>` and the environment is only known at run time.

Each check runs before construction. A missing value aborts with a message
naming the command, the missing key paths, and the files they belong in.

### Constructor

The runner constructs the class with a single object:

```js
constructor(args) {
    const { projectDirectory, cloudflareConfig, config, secrets } = args ?? {};
}
```

- `projectDirectory` — Directory owning the `.kixx` directory, discovered by
  walking up from the directory argument (default: the working directory).
  Falls back to that starting directory when no project is found.
- `config` — Deeply frozen merge of `~/.kixx/config.json` and
  `<project>/.kixx/config.json`, project layer last.
- `secrets` — Same merge for `secrets.json`.
- `cloudflareConfig` — The parsed `cloudflare-config.jsonc` from the project
  directory, or `undefined` for any command other than `cloudflare`. The
  runner guarantees a plain object with an `environments` object; anything
  else is reported before the command is constructed.

The runner passes nothing else. A command which writes results also accepts an
`output` stream, defaulting to `process.stdout`, and any collaborator it wants
a test to be able to replace (API client factories, `fileSystem`, `now`). A command which needs none of this can
omit the constructor entirely.

### run()

```js
async run(options) {}
```

`options` is the parsed flag values. Return an integer to set the process exit
code — `0` for success. A non-integer return leaves the exit code alone, which
also means success.

Write results to the injected `output` stream rather than to `process.stdout`
directly, so a test can read what was written without replacing a global.
Default it in the constructor:

```js
const { output = process.stdout } = args ?? {};
```

Pass human-readable text through
`wrapText()` from `lib/text-wrap.js` so it wraps at 80 columns; write
machine-readable output, such as JSON or a bare token, unwrapped. Throw
`UsageError` (from `lib/usage-error.js`) for anything the user can fix by
changing arguments or settings: the runner prints its message alone, wrapped,
with no stack trace. Any other error prints `Failed to run command:` followed
by the full error, which is what you want for a genuine defect. Both exit with
code `1`.


Adding a New Command
--------------------

To add a sub-command to an existing command:

1. Create `commands/<command>/<subcommand>.js` default-exporting the class.
2. Import the class in `commands/<command>/index.js` and add it to the
   `subcommands` map under the file's basename.

To add a new top level command, also create the directory and its `index.js`
exporting `description` and `subcommands`, then import that `index.js` as a
namespace in `commands/index.js` and add it to the default-exported map.

Then verify:

```
node devkit/kixx.js                                  # the command lists
node devkit/kixx.js <command> --help                 # the sub-command lists
node devkit/kixx.js <command> <subcommand> --help
node devkit/kixx.js <command> <subcommand>           # the real thing
node devkit/run-tests.js devkit/test/commands
node devkit/run-linter.js devkit
```

Run these from the repository root.

Shared logic belongs in `devkit/lib/`, not in a command module. A command should read
as the wiring between parsed arguments, loaded settings, and a library call —
`commands/admin/gen-secure-token.js` is the smallest model: it makes one
library call, prints the result, and returns.

Modules under `devkit/` never import from outside `devkit/` (the package is
published stand-alone). The one exception is `devkit/test/conformance/`,
which may read the repository's `lib/` to prove wire compatibility.
