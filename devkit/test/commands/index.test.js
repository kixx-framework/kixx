import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import commands, { groups } from '../../commands/index.js';
import { findCommandProblems, findRegistryProblems } from '../../lib/command-registry.js';
import { requiresProject } from '../../lib/command-positionals.js';


const COMMANDS_DIRECTORY = fileURLToPath(new URL('../../commands/', import.meta.url));


// Resolves the command name each module's path stands for: `dev.js` is "dev"
// and `release/list.js` is "release list".
async function listCommandModules() {
    const pathnames = [];

    for (const entry of await fsp.readdir(COMMANDS_DIRECTORY, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            // eslint-disable-next-line no-await-in-loop
            const files = await fsp.readdir(path.join(COMMANDS_DIRECTORY, entry.name));
            pathnames.push(...files.map((file) => `${ entry.name }/${ file }`));
        } else {
            pathnames.push(entry.name);
        }
    }

    return pathnames
        .filter((pathname) => pathname.endsWith('.js') && pathname !== 'index.js')
        .map((pathname) => ({
            pathname,
            name: pathname.slice(0, -'.js'.length).replace('/', ' '),
        }));
}


describe('commands/index.js registry', ({ it }) => {

    it('has well-formed names, and groups for exactly its two-word names', () => {
        assertEqual('', findRegistryProblems(commands, groups).join('; '));
    });

    it('meets the static contract with every command', () => {
        for (const [ name, Command ] of Object.entries(commands)) {
            assertEqual('', findCommandProblems(Command).join('; '), `"${ name }"`);
        }
    });

    it('registers every command module under the name its path stands for', async () => {
        const modules = await listCommandModules();

        for (const { pathname, name } of modules) {
            // eslint-disable-next-line no-await-in-loop
            const mod = await import(pathToFileURL(path.join(COMMANDS_DIRECTORY, pathname)).href);

            assertEqual(mod.default, commands[name], `commands/${ pathname } is registered as "${ name }"`);
        }
    });

    // The runner gives a project directory and settings only to a command
    // that declares it runs inside a project.
    it('runs every working command inside a project', () => {
        for (const name of [ 'generate', 'dev', 'local create', 'local start', 'local list', 'local destroy' ]) {
            assertEqual(true, requiresProject(commands[name]), `"${ name }"`);
        }

        assertEqual(true, commands.generate.requiresTooling);
    });

    it('has a module at its path for every command that is available', async () => {
        const modules = await listCommandModules();

        // A placeholder has no module. The names are pinned in tree.test.js.
        const available = Object.entries(commands)
            .filter(([ , Command ]) => Command.available !== false)
            .map(([ name ]) => name);

        assertEqual(
            available.toSorted().join(','),
            modules.map(({ name }) => name).toSorted().join(','),
        );
    });
});
