Kixx Devkit Commands
====================

How the `kixx-dev` CLI finds and runs a command, what a command reports, and what you need to write to add one. Paths are relative to `devkit/`.

Every command follows one contract: it is found in one registry, run by one runner (`lib/run-cli.js`), reports through one `--json` envelope, and exits with a code from one table.

**The `--json` output and the exit codes are a stable interface.** Scripts and agents parse them. Change them by addition only: never rename or remove a field, change a field's type, or change what a number means.


Command Names and the Registry
------------------------------

A command name is one word or two:

```
kixx-dev <command> [options] [...args]            # dev, generate
kixx-dev <group> <command> [options] [...args]    # release list, local create
```

The first word of a two-word name is a **group**. No name is both a command and a group.

`commands/index.js` is the registry. Its default export is one flat map from command name to command class, in the order help lists the commands. Its `groups` export maps each group to a one-line description:

```js
import DevCommand from './dev.js';
import GenerateCommand from './generate.js';
import LocalCreateCommand from './local/create.js';
import createPlaceholderCommand from '../lib/placeholder-command.js';

export const groups = Object.freeze({
    local: 'Throwaway local instances of the app',
    release: 'Release history and emergency rollback',
});

export default Object.freeze({
    'generate': GenerateCommand,
    'dev': DevCommand,
    'local create': LocalCreateCommand,
    'release list': createPlaceholderCommand('Show the release history'),
});
```

**The tree is the CLI-5 table** of REQUIREMENTS.md, plus `generate`: 32 names. Six work in this version (`generate`, `dev`, and `local create`, `start`, `list`, and `destroy`). The other 26 are placeholders (see "Placeholders"). `test/commands/tree.test.js` holds every name and whether it works, so adding or removing a command, or building a placeholder, means changing that test in the same change. The v6 names with no row (`dev start`, `app publish`, the `cloudflare` worker commands, and so on) are gone, with no alias.

A one-word command lives at `commands/<name>.js`. A two-word command lives at `commands/<group>/<name>.js`.

The CLI never reads the `commands/` directory. Static imports keep every command in the module graph, which is what lets the CLI run when installed from JSR, where there is no local directory to read.

`test/commands/index.test.js` fails when a module under `commands/` is not registered under the name its path stands for, when a name is malformed or is both a command and a group, when a group has no description or no command, or when a command breaks the static contract below.


How a Command Line Is Read
--------------------------

`kixx-dev.js` only passes `process.argv`, the working and home directories, the process streams, the registry, and the project tooling loader to `runCli()`, and sets `process.exitCode` to what it resolves. Everything else is in `lib/run-cli.js`, so tests run the whole contract in process with fake streams and a fake registry.

1. The **global flags** are taken off the command line, wherever they are: `--help` (`-h`), `--version` (`-v`), and `--json`. They work with or without a command. No command may declare `help`, `version`, `json`, `-h`, or `-v`.
2. `--version` prints the version and stops.
3. The **command words** are the leading tokens before the first flag. The runner tries the first two words as a name, then the first word.
4. With no match: `--help` alone prints every command, and `<group> --help` prints the group's commands. Anything else is a usage error (exit 2) that lists what exists on stderr.
5. `--help` with a command prints that command's help and stops. Nothing is loaded for help, so it works outside a project and in a directory with broken settings.
6. Otherwise the remaining tokens are parsed with the command's `options` and the positionals are split.
7. A command that declares `requiresProject` or `requiresTooling` then gets its project (next section). Any other command is constructed with its streams alone.
8. The command is constructed and run.


Finding the Project
-------------------

A command that sets `static requiresProject = true` runs inside a Kixx project. For it, and only for it, the runner does this, in order:

1. **Start directory.** The optional trailing `[directory]` argument, resolved against the working directory, or the working directory itself. A directory that does not exist exits 2.
2. **Discovery** (`lib/project/find-project.js`). The project is the nearest directory, at or above the start directory, that holds `kixx/plugin.json`. So a command works from any subdirectory of a project. With none found, `ProjectNotFoundError` exits 3. The `.kixx/` settings directory does not mark a project: a fresh clone has none.
3. **The version gate** (`lib/project/project-version.js`). The runner reads `version` from `kixx/plugin.json` as data, before any project code is loaded. A project is supported when its major version equals that of `OLDEST_SUPPORTED_PROJECT_VERSION` (`7.0.0`) and its version is at least that, with a prerelease tag ignored: `7.0.0-alpha.0` passes. Anything else, a manifest that is not JSON, or one with no valid `version`, is `UnsupportedProjectVersionError`, exit 3, with a message that names both versions and what to do. A supported project that is newer than this `kixx-dev` runs, after one line on stderr saying so.
4. **Settings** (`lib/config-loader.js`). `~/.kixx/` merged under `<project>/.kixx/`. A project needs no `.kixx/` directory. When the project is the home directory, the one `.kixx/` is loaded once. Then `requiredConfig` and `requiredSecrets` are checked.
5. **Tooling**, only for `static requiresTooling = true` (`lib/project/load-project-tooling.js`). The runner imports three modules from the project's own `kixx/` and passes them to the command as `tooling`:

   ```js
   const { tooling, createProjectFileSystem, createFileSystemContentSource } = this.#tooling;
   ```

   - `tooling` is the project's `kixx/tooling/mod.js`: the generator, the manifest readers, and the content compiler.
   - `createProjectFileSystem(projectDirectory)` is from `kixx/adapters/node/tooling/lib/project-file-system.js`.
   - `createFileSystemContentSource(projectDirectory)` is from `kixx/adapters/node/content-compiler/lib/file-system-content-source.js`.

   A missing module, or a tooling module without an export the devkit calls (`REQUIRED_TOOLING_EXPORTS`), exits 3 and names it. When you call a tooling export for the first time, add its name to that list and to `test/conformance/project-tooling.test.js`.

This is how one `kixx-dev` works across project versions: framework logic comes from the project, never from a copy in the devkit. Three rules follow.

- **The loader is the only module with a dynamic `import()`**, and it imports only those three modules: never the project's `app/`, `plugins/`, or an entry point. `test/import-hygiene.test.js` enforces both, and that nothing else in the devkit imports from outside it.
- **Never use `instanceof` on something project code made or threw.** Its classes come from the project's copy of Kixx, so they are never a devkit class. Match an error by `error.name`, and check a value by its shape.
- **A command takes `tooling` as a constructor argument and never imports core.** Its unit test passes a fake.

`--help`, `--version`, a placeholder, and a command without `requiresProject` never read `kixx/plugin.json`, load settings, or call the loader.


The Command Module
------------------

A command module default-exports a class. Static properties declare everything the runner needs to know *before* constructing it (help text, argument parsing rules, and required settings), so a command never runs partially configured.

```js
import process from 'node:process';
import { listInstances, resolveInstancesDirectory } from '../../lib/local/instance-store.js';

export default class LocalListCommand {

    static description = 'List the local instances in the target';

    static options = {
        target: {
            type: 'string',
            short: 't',
            description: 'Directory holding instances/; default <app>/.kixx',
        },
    };

    #projectDirectory;
    #output;

    constructor(args) {
        const { projectDirectory, output = process.stdout } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#output = output;
    }

    async run(options) {
        const instancesDirectory = resolveInstancesDirectory({
            sourceDirectory: this.#projectDirectory,
            target: options.target,
        });

        const instances = await listInstances({ instancesDirectory });

        for (const { name, port } of instances) {
            this.#output.write(`${ name }  ${ port }\n`);
        }

        return { instances: instances.map(({ name, port }) => ({ name, port })) };
    }
}
```

### Static properties

**`description`**: a sentence or paragraph shown by `--help` and in command lists. Required. Descriptions are put on one line and re-wrapped to the help line width, so the indentation of a template literal is irrelevant.

**`options`**: passed straight to `node:util` `parseArgs` as its `options` config, so `type` (`'string'` or `'boolean'`), `short`, `multiple`, and `default` all behave as documented there. The extra `description` key is used only for help. Negated boolean flags (`--no-foo`) are enabled. Never declare a global flag.

**`positionals`**: an optional array of required leading arguments, each `{ name, description }`:

```js
static positionals = [
    { name: 'name', description: 'Instance name' },
];
```

Every declared positional is required. A `requiresProject` command also takes the optional trailing `directory`, which the runner owns and uses to find the project: usage reads `kixx-dev local create [options] <name> [directory]`, and help lists the declared positionals before `directory`. A command that runs outside a project takes no `directory`, and one given to it is a usage error. Names match `^[a-z][a-z0-9-]*$`, are unique, and are never `directory`. A missing value or an extra argument is a usage error. Take anything optional as an option, never as a positional.

**`requiredConfig`**: dotted key paths which must be present in the merged `.kixx/config.json` layers.

**`requiredSecrets`**: dotted key paths which must be present in the merged `.kixx/secrets.json` layers.

Each check runs before construction. A missing value is a usage error naming the command, the missing key paths, and the files they belong in. Settings are loaded only inside a project, so a command that declares either one must also declare `requiresProject`.

**`requiresProject`**: `true` for a command that runs inside a project. The runner finds the project, checks its version, loads the settings, accepts the trailing `[directory]`, and passes `projectDirectory`, `config`, and `secrets`. See "Finding the Project".

**`requiresTooling`**: `true` for a command that calls the project's own Kixx code. It implies `requiresProject`, and the runner also passes `tooling`.

A command with neither runs anywhere. It is given its streams and nothing else.

**`available`**: `false` only on a placeholder (see below). Leave it out of a real command.

`lib/command-registry.js` exports `findCommandProblems()`, which checks these declarations; the registry test runs it on every command.

### Constructor

The runner constructs the class with a single object:

```js
constructor(args) {
    const { projectDirectory, config, secrets, tooling, output, stdout, stderr } = args ?? {};
}
```

- `projectDirectory`: the project root, an absolute path. Only with `requiresProject`.
- `config`: the deeply frozen merge of `~/.kixx/config.json` and `<project>/.kixx/config.json`, project layer last. Only with `requiresProject`.
- `secrets`: the same merge for `secrets.json`. Only with `requiresProject`.
- `tooling`: the frozen `{ tooling, createProjectFileSystem, createFileSystemContentSource }` loaded from the project. Only with `requiresTooling`.
- `output`: the stream for the command's human-readable text.
- `stdout` and `stderr`: streams for a child process's output, used by the commands that run the app.

The runner passes nothing else. A command also accepts any collaborator it wants a test to replace (API client factories, `fileSystem`, `now`). Default `output`, `stdout`, and `stderr` to the process streams so a test can construct the command with only what it cares about; the runner always passes all three, so nothing it constructs falls back to those defaults. A command which needs none of this can omit the constructor.

### run()

```js
async run(options, positionals) {}
```

`options` is the parsed flag values. `positionals` is an object keyed by declared positional name (`{}` when the command declares none).

**Return data, not text.** `run()` resolves a plain, JSON-serializable object, which becomes the envelope's `data`, or `undefined`, which becomes `{}`. Never return a secret value. Anything else is a defect and exits 1.

What the working commands return:

| Command | `data` |
|---|---|
| `generate` | `{ projectDirectory, files }` |
| `dev`, `local start` | `{ port, environment }`, when the server stops; `port` is the port it bound |
| `local create` | `{ name, port, buildId, directory }`; never the secrets it generates |
| `local list` | `{ instances: [ { name, port, seeded, running } ] }`; `port` and `running` are `null` for an instance directory with no readable metadata |
| `local destroy` | `{ name }` |

**Signal failure only by throwing.** A command never picks an exit code and never returns one. Throw `UsageError` (from `lib/usage-error.js`) for anything the user can fix by changing arguments, settings, or the outside world. Any other error is treated as a defect. See `docs/error-handling.md`.

**Write human text to `output`.** Never write to `process.stdout` directly: under `--json` the runner hands the command `stderr` as its `output` and `stdout`, so stdout holds only the envelope. Pass human-readable text through `wrapText()` from `lib/text-wrap.js` so it wraps at 80 columns. The returned data is never printed without `--json`, so print what a person needs to see.

A long-running command (`dev`, `local start`) resolves once, when it stops. Until then stdout is silent under `--json`, and its log lines and the app's output go to stderr.


The `--json` Envelope
---------------------

With `--json`, stdout holds exactly one line: one JSON object and a newline.

Success:

```json
{"ok":true,"command":"local list","data":{"instances":[]}}
```

Failure:

```json
{"ok":false,"command":"local create","error":{"code":"UsageError","exitCode":2,"message":"Missing required argument <name>. Run \"kixx-dev local create --help\" for usage."}}
```

| Field | Value |
|---|---|
| `ok` | `true` or `false`. |
| `command` | The registered command name, or `null` when none resolved: top-level help, a group's help, `--version`, or an unknown command. |
| `data` | Present when `ok` is `true`. What the command returned, or `{}`. |
| `error.code` | Present when `ok` is `false`. A stable name: an exit-code table name, the `code` of a `UsageError` subclass (such as `UnsupportedServerError`), or `ValidationError` or `OperationalError` from the project's own Kixx code. |
| `error.exitCode` | The process exit code. |
| `error.message` | The message a person would read. |
| `error.problems` | Only for `ValidationError`: `[ { "message", "source" } ]`, one entry per problem. An error code may add fields of its own like this one. |

Under `--json`, everything a command writes for a person goes to stderr. A usage error prints nothing to stderr, because its message is in the envelope. An unexpected error (exit 1) also prints its stack to stderr.

### Help and version as data

`kixx-dev --version --json`:

```json
{"ok":true,"command":null,"data":{"version":"7.0.0-alpha.0"}}
```

`kixx-dev --help --json` returns `data` as `{ version, commands, exitCodes }`. Each entry of `commands` is `{ name, description, available }`, and `exitCodes` is the table below as `{ code, name, meaning }` rows.

`kixx-dev <group> --help --json` returns `{ group, description, commands }`.

`kixx-dev <command> --help --json` returns:

```json
{
    "name": "local create",
    "available": true,
    "description": "Create a throwaway local instance of the app: ...",
    "usage": "kixx-dev local create [options] <name> [directory]",
    "positionals": [
        { "name": "name", "description": "Instance name: ...", "required": true },
        { "name": "directory", "description": "A directory in the project; ...", "required": false }
    ],
    "options": [
        { "name": "target", "short": "t", "type": "string", "multiple": false, "default": null, "description": "..." }
    ],
    "requiredConfig": [],
    "requiredSecrets": [],
    "requiresProject": true
}
```

`requiresProject` is `true` for a command that declares `requiresProject` or `requiresTooling`, and only then is `directory` in `positionals`. `short` and `default` are `null` when the option declares none. The text help is rendered from this same data (`lib/render-help.js`).


Exit Codes
----------

Each number means one thing for every command. The table lives in `lib/exit-codes.js`, and `test/lib/exit-codes.test.js` fails when this copy differs from it.

| Code | Name | Meaning |
|---|---|---|
| 0 | `Success` | The command finished. |
| 1 | `UnexpectedError` | An unexpected error: a defect, printed with its stack. |
| 2 | `UsageError` | A mistake the user can fix. The message is printed with no stack. |
| 3 | `ProjectNotFound` | The command needs a Kixx project and was not run inside one. |
| 3 | `UnsupportedProjectVersion` | This kixx-dev does not support the project's Kixx version. |
| 4 | `CommandNotAvailable` | The command is not available in this version of kixx-dev. |

Codes 10 and up are for named refusals, which later commands add as rows of this table. Every code stays below 126, where shells' own codes start.

An unknown command, a group with no command name, a bad flag, a missing positional, a directory that does not exist, and a missing required setting all exit 2.

The runner maps a thrown error to a row in this order (`describeError()` in `lib/exit-codes.js`):

1. An error whose `code` is a name in the table gets that row. `CommandNotAvailableError`, `ProjectNotFoundError`, and `UnsupportedProjectVersionError` are `UsageError` subclasses that each declare a `static code` equal to their row's name.
2. Any other `UsageError`, subclasses included, exits 2. `error.code` is the error's own `code`, which is its class name.
3. An error named `ValidationError` or `OperationalError` exits 2 with its message alone. These come from the project's own Kixx code and describe a problem the developer can fix: `kixx-dev generate` with an invalid manifest ends here. They are matched by `name`, never with `instanceof`, because the class comes from the project's copy of Kixx. The message of a manifest `ValidationError` already lists every problem, so text mode prints nothing more; `--json` also carries them as `error.problems`.
4. Everything else exits 1 as `UnexpectedError`.

To add a code: add a row to `EXIT_CODES` and to the table above, and give the error class a `static code` equal to the row's name.


Placeholders
------------

A placeholder reserves the name of a command that is not built yet. `createPlaceholderCommand(description)` in `lib/placeholder-command.js` returns a class with `available = false`. Register it in `commands/index.js` straight from the factory; it has no module of its own:

```js
import createPlaceholderCommand from '../lib/placeholder-command.js';

export default Object.freeze({
    deploy: createPlaceholderCommand('Bundle, pre-stage, and deploy to Cloudflare'),
});
```

- Help lists it marked "Not available in this version of kixx-dev."
- `kixx-dev deploy --help` exits 0 and says the same. Its `--help --json` has `"available": false`.
- Running it exits 4 with `error.code` `CommandNotAvailable`, whatever arguments it is given. The runner does not parse a placeholder's arguments, because its real options don't exist yet, and loads no settings for it.

The runner constructs a placeholder with `commandName` so its message can name the command. To build the command, replace the factory call with an import of the real module, and change its line in `test/commands/tree.test.js`.

Text a command prints never names a placeholder as the next step.


Adding a Command
----------------

1. Create `commands/<name>.js`, or `commands/<group>/<name>.js`, default-exporting the class. Declare `requiresProject` if it runs inside a project, or `requiresTooling` if it calls the project's Kixx code.
2. Import the class in `commands/index.js` and add it to the map under its name. For a new group, add the group to `groups`.
3. Add its name to the tree in `test/commands/tree.test.js`, or change its line there when it replaces a placeholder.
4. Write its test in `test/commands/`, at the mirrored path. Construct the class with a captured `output` and fakes; assert on what it returns, writes, and throws.

Then verify, from the repository root:

```
node devkit/kixx-dev.js --help                    # the command lists
node devkit/kixx-dev.js <command> --help
node devkit/kixx-dev.js <command> --help --json
node devkit/kixx-dev.js <command>                 # the real thing
node devkit/kixx-dev.js <command> --json; echo $?
node devkit/run-tests.js devkit/test/commands
node devkit/run-linter.js devkit
```

Shared logic belongs in `lib/`, not in a command module. A command should read as the wiring between parsed arguments, loaded settings, and a library call.

Modules under `devkit/` never import from outside `devkit/` (the package is published stand-alone). At run time the only way out is the tooling loader. The one exception in tests is `test/conformance/`, which may read the repository's core.

When you try a command by hand, pass a project directory, such as one built with `node tools/build-project.js tmp/core-only`. This repository's root holds `kixx/plugin.json`, so from inside the repository, outside a built project, `kixx-dev` finds the repository root as the project. Never run `kixx-dev generate` there: it would write five generated files at the repository root.
