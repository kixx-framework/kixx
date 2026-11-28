import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual } from '../lib/vendor/kixx-assert/mod.js';


const DEVKIT_DIRECTORY = fileURLToPath(new URL('../', import.meta.url));

// Vendored code is third-party, tests may spawn, and node_modules/ is not
// ours. Paths are relative to devkit/, with forward slashes.
const SKIPPED_DIRECTORIES = [ 'lib/vendor', 'node_modules', 'test' ];

// The CLI's Deno permissions include --allow-run for two things only: the
// local git binary and the app child process (CLI-10). Every module that can
// start a process is listed here, so a new one is a deliberate change.
const SUBPROCESS_MODULES = [ 'lib/devserver/app-process.js' ];

const CHILD_PROCESS_SPECIFIER = /['"`](?:node:)?child_process['"`]/;


describe('devkit import hygiene', ({ before, it }) => {
    let sourceFiles;

    before(async () => {
        sourceFiles = await readSourceFiles(DEVKIT_DIRECTORY);
    });

    it('walks the entry point, the commands, and lib/', () => {
        const pathnames = sourceFiles.map(({ pathname }) => pathname);

        assert(pathnames.includes('kixx-dev.js'), 'reads kixx-dev.js');
        assert(pathnames.includes('commands/index.js'), 'reads commands/index.js');
        assert(pathnames.includes('lib/usage-error.js'), 'reads lib/usage-error.js');
        assert(!pathnames.some((pathname) => pathname.startsWith('lib/vendor/')), 'skips lib/vendor/');
        assert(!pathnames.some((pathname) => pathname.startsWith('test/')), 'skips test/');
    });

    it('imports node:child_process only in the listed modules', () => {
        const pathnames = sourceFiles
            .filter(({ source }) => CHILD_PROCESS_SPECIFIER.test(source))
            .map(({ pathname }) => pathname);

        assertEqual(SUBPROCESS_MODULES.join(','), pathnames.join(','));
    });
});


// Resolves every JavaScript file under the directory as `{ pathname, source }`,
// sorted by pathname, so a failure lists the same files on every machine.
async function readSourceFiles(rootDirectory) {
    const pathnames = await listJavaScriptFiles(rootDirectory, '');

    pathnames.sort();

    return await Promise.all(pathnames.map(async (pathname) => {
        const source = await fsp.readFile(path.join(rootDirectory, pathname), 'utf8');
        return { pathname, source };
    }));
}

async function listJavaScriptFiles(rootDirectory, relativeDirectory) {
    const entries = await fsp.readdir(path.join(rootDirectory, relativeDirectory), { withFileTypes: true });
    const pathnames = [];

    for (const entry of entries) {
        const pathname = relativeDirectory ? `${ relativeDirectory }/${ entry.name }` : entry.name;

        if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.includes(pathname)) {
                // eslint-disable-next-line no-await-in-loop
                pathnames.push(...await listJavaScriptFiles(rootDirectory, pathname));
            }
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            pathnames.push(pathname);
        }
    }

    return pathnames;
}
