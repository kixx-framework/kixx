import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../lib/vendor/kixx-assert/mod.js';
import commands, { groups } from '../../commands/index.js';
import runCli from '../../lib/run-cli.js';
import captureOutput from '../helpers/capture-output.js';
import { withTemporaryDirectory } from '../helpers/temporary-project.js';


const DEVKIT_DIRECTORY = fileURLToPath(new URL('../../', import.meta.url));

// The command tree: every row of the CLI-5 table in REQUIREMENTS.md, grouped
// as the table groups them, plus `generate`. `true` is a command that works
// and `false` is a placeholder. A section that builds a command changes its
// line here in the same change, so the tree never moves by accident.
const TREE = [
    [ 'new', false ],
    [ 'add', false ], [ 'remove', false ],
    [ 'upgrade', false ],
    [ 'agents sync', false ],
    [ 'dev', true ],
    [ 'local create', true ], [ 'local start', true ], [ 'local list', true ], [ 'local destroy', true ],
    [ 'local seed', false ], [ 'local publish', false ],
    [ 'check', false ], [ 'routes', false ], [ 'render', false ],
    [ 'publish', false ],
    [ 'deploy', false ],
    [ 'release list', false ], [ 'release assign', false ],
    [ 'media upload', false ],
    [ 'env create', false ], [ 'env list', false ],
    [ 'cloudflare provision', false ],
    [ 'secrets set', false ], [ 'secrets rotate', false ],
    [ 'deploy-key generate', false ], [ 'deploy-key rotate', false ],
    [ 'admin invite', false ], [ 'admin reset', false ], [ 'admin migrations', false ], [ 'admin jobs', false ],

    // Not in the CLI-5 table: the command a project regenerates with.
    [ 'generate', true ],
];

const WORKING = TREE.filter(([ , available ]) => available).map(([ name ]) => name);
const PLACEHOLDERS = TREE.filter(([ , available ]) => !available).map(([ name ]) => name);

// v6 names with no CLI-5 row. None is an alias (D45).
const REMOVED = [
    [ 'dev', 'start' ],
    [ 'app', 'publish' ],
    [ 'app', 'assign-build' ],
    [ 'cloudflare', 'create-worker' ],
    [ 'admin', 'gen-secure-token' ],
    [ 'admin', 'accept-invite' ],
];

// Arguments a placeholder's real command might take one day. None of them
// may change the answer.
const ARBITRARY_ARGUMENTS = [ '-e', 'production', '--build-id', 'abc', 'some/path', '--force' ];


async function run(argv, cwd) {
    const stdout = captureOutput();
    const stderr = captureOutput();

    const code = await runCli({
        argv,
        cwd,
        homeDirectory: cwd,
        stdout,
        stderr,
        commands,
        groups,
        loadProjectTooling() {
            throw new Error('the tooling loader was called');
        },
    });

    return { code, stdout: stdout.chunks.join(''), stderr: stderr.chunks.join('') };
}

async function readCommandSources() {
    const directory = path.join(DEVKIT_DIRECTORY, 'commands');
    const entries = await fsp.readdir(directory, { withFileTypes: true, recursive: true });

    const filepaths = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => path.join(entry.parentPath, entry.name));

    return await Promise.all(filepaths.map(async (filepath) => {
        return { pathname: path.relative(DEVKIT_DIRECTORY, filepath), text: await fsp.readFile(filepath, 'utf8') };
    }));
}


describe('the command tree', ({ it }) => {

    it('is the CLI-5 table and generate: 6 working commands and 26 placeholders', () => {
        assertEqual(6, WORKING.length);
        assertEqual(26, PLACEHOLDERS.length);

        assertEqual(
            TREE.map(([ name ]) => name).toSorted().join('\n'),
            Object.keys(commands).toSorted().join('\n'),
        );
    });

    it('has each command available, or a placeholder, as listed', () => {
        for (const [ name, available ] of TREE) {
            assertEqual(available, commands[name]?.available !== false, `"${ name }" available`);
        }
    });

    it('lists every command in top-level help, with the placeholders marked', async () => {
        const text = await run([ '--help' ], os.tmpdir());
        const json = await run([ '--help', '--json' ], os.tmpdir());

        assertEqual(0, text.code);
        assertEqual(0, json.code);

        const listed = JSON.parse(json.stdout).data.commands;

        assertEqual(TREE.length, listed.length);

        for (const [ name, available ] of TREE) {
            const entry = listed.find((command) => command.name === name);

            assertEqual(available, entry?.available, `"${ name }" in help data`);
            assert(entry.description.length > 0, `"${ name }" has a description`);
        }

        // Each command's block runs from its name to the next line that
        // starts a name, so a wrapped description stays with its command.
        const blocks = text.stdout.split(/\n(?= {2}[a-z])/);

        for (const [ name, available ] of TREE) {
            const block = blocks.find((candidate) => candidate.startsWith(`  ${ name }  `));

            assert(block, `"${ name }" is listed`);

            assertEqual(
                !available,
                block.replace(/\s+/g, ' ').includes('Not available in this version of kixx-dev.'),
                `"${ name }" marked as not available`,
            );
        }
    });

    it('lists a group\'s commands in the group\'s help', async () => {
        const { code, stdout } = await run([ 'release', '--help' ], os.tmpdir());

        assertEqual(0, code);
        assertMatches('Usage: kixx-dev release <command>', stdout);
        assertMatches(/^ {2}release list {2,}/m, stdout);
        assertMatches(/^ {2}release assign {2}/m, stdout);
        assert(!stdout.includes('local create'), 'lists another group\'s command');
    });

    it('shows help for every placeholder and says it is not available', async () => {
        for (const name of PLACEHOLDERS) {
            const words = name.split(' ');

            // eslint-disable-next-line no-await-in-loop
            const text = await run([ ...words, '--help' ], os.tmpdir());
            // eslint-disable-next-line no-await-in-loop
            const json = await run([ ...words, '--help', '--json' ], os.tmpdir());

            assertEqual(0, text.code, `"${ name }" --help`);
            assertMatches('Not available in this version of kixx-dev.', text.stdout, `"${ name }" --help`);

            const { data } = JSON.parse(json.stdout);

            assertEqual(0, json.code, `"${ name }" --help --json`);
            assertEqual(name, data.name);
            assertEqual(false, data.available, `"${ name }" --help --json`);
        }
    });

    it('exits 4 for every placeholder, whatever its arguments', async () => {
        for (const name of PLACEHOLDERS) {
            const words = name.split(' ');

            // eslint-disable-next-line no-await-in-loop
            const text = await run([ ...words, ...ARBITRARY_ARGUMENTS ], os.tmpdir());
            // eslint-disable-next-line no-await-in-loop
            const json = await run([ ...words, ...ARBITRARY_ARGUMENTS, '--json' ], os.tmpdir());

            assertEqual(4, text.code, `"${ name }"`);
            assertEqual('', text.stdout, `"${ name }" stdout`);
            assertMatches(`The "${ name }" command is not available`, text.stderr.replace(/\s+/g, ' '));

            const envelope = JSON.parse(json.stdout);

            assertEqual(4, json.code, `"${ name }" --json`);
            assertEqual(false, envelope.ok);
            assertEqual(name, envelope.command);
            assertEqual('CommandNotAvailable', envelope.error.code);
            assertEqual(4, envelope.error.exitCode);
        }
    });

    it('exits 2 for the v6 command names', async () => {
        await withTemporaryDirectory(async (directory) => {
            for (const words of REMOVED) {
                // eslint-disable-next-line no-await-in-loop
                const { code, stdout } = await run([ ...words, '--json' ], directory);
                const envelope = JSON.parse(stdout);

                assertEqual(2, code, words.join(' '));
                assertEqual('UsageError', envelope.error.code, words.join(' '));
            }

            // "app" names nothing, and "cloudflare" and "admin" are groups
            // without these verbs.
            const app = JSON.parse((await run([ 'app', 'publish', '--json' ], directory)).stdout);
            const admin = JSON.parse((await run([ 'admin', 'gen-secure-token', '--json' ], directory)).stdout);

            assertEqual(null, app.command);
            assertMatches('The command "app" does not exist', app.error.message);
            assertEqual(null, admin.command);
            assertMatches('The command "admin gen-secure-token" does not exist', admin.error.message);

            // "dev" is a command now, so "start" reads as its directory
            // argument, and no such directory exists.
            const dev = JSON.parse((await run([ 'dev', 'start', '--json' ], directory)).stdout);

            assertEqual('dev', dev.command);
            assertMatches(/start does not exist/, dev.error.message.replace(/\s+/g, ' '));
        });
    });

    it('exits 3 for dev and the local commands outside a project', async () => {
        await withTemporaryDirectory(async (directory) => {
            const commandLines = [
                [ 'dev' ],
                [ 'local', 'create', 'alpha' ],
                [ 'local', 'start', 'alpha' ],
                [ 'local', 'list' ],
                [ 'local', 'destroy', 'alpha' ],
            ];

            for (const argv of commandLines) {
                // eslint-disable-next-line no-await-in-loop
                const { code, stdout } = await run([ ...argv, '--json' ], directory);
                const envelope = JSON.parse(stdout);

                assertEqual(3, code, argv.join(' '));
                assertEqual('ProjectNotFound', envelope.error.code, argv.join(' '));
            }
        });
    });
});

describe('command modules', ({ it }) => {

    // The runner passes the streams, so stdout holds only the envelope under
    // --json. A default lets a test or a script construct a command directly.
    it('touch a process stream only as a constructor default', async () => {
        for (const { pathname, text } of await readCommandSources()) {
            const uses = text.match(/process\.(?:stdout|stderr)\b/g) ?? [];
            const defaults = text.match(/^\s+\w+ = process\.(?:stdout|stderr),$/gm) ?? [];

            assertEqual(defaults.length, uses.length, pathname);
        }
    });

    it('name kixx-dev, never the v6 binary, in what they print', async () => {
        const sources = await readCommandSources();

        for (const pathname of [ 'lib/local/command-support.js', 'lib/local/instance-store.js', 'lib/devserver/run-dev-server.js' ]) {
            // eslint-disable-next-line no-await-in-loop
            sources.push({ pathname, text: await fsp.readFile(path.join(DEVKIT_DIRECTORY, pathname), 'utf8') });
        }

        for (const { pathname, text } of sources) {
            const match = /\bkixx\s+(?:dev|local|app|admin|cloudflare)\b/.exec(text);

            assertEqual(null, match?.[0] ?? null, pathname);
        }
    });

    // A next step a command prints must be a command that works.
    it('name no placeholder as a next step', async () => {
        for (const { pathname, text } of await readCommandSources()) {
            if (pathname === 'commands/index.js') {
                continue;
            }

            for (const name of [ 'local seed', 'local publish', 'seed $', 'publish $' ]) {
                assert(!text.includes(name), `${ pathname } names "${ name }"`);
            }
        }
    });
});
