import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../lib/vendor/kixx-assert/mod.js';


const DEVKIT_DIRECTORY = fileURLToPath(new URL('../', import.meta.url));

// Vendored code is third-party, tests may spawn, and node_modules/ is not
// ours. Paths are relative to devkit/, with forward slashes.
const SKIPPED_DIRECTORIES = [ 'lib/vendor', 'node_modules', 'test' ];

// The CLI's Deno permissions include --allow-run for two things only: the
// local git binary and the app child process (CLI-10). Every module that can
// start a process is listed here, so a new one is a deliberate change.
const SUBPROCESS_MODULES = [ 'lib/devserver/app-process.js' ];

const CHILD_PROCESS_SPECIFIER = /['"`](?:node:)?child_process['"`]/;

// The one module that loads code at run time: the project's own tooling
// (CLI-3). It is the only way the devkit reaches code outside itself.
const DYNAMIC_IMPORT_MODULES = [ 'lib/project/load-project-tooling.js' ];

// What that module may import from a project, as paths from the project
// root: three modules of the project's core. Never its app/, plugins/, or an
// entry point.
const PROJECT_MODULES = [
    'kixx/adapters/node/content-compiler/lib/file-system-content-source.js',
    'kixx/adapters/node/tooling/lib/project-file-system.js',
    'kixx/tooling/mod.js',
];

// `import x from '...'`, `export ... from '...'`, and `import '...'`.
const STATIC_IMPORT = /(?:^|[\n;])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1|(?:^|[\n;])\s*import\s*(['"])([^'"\n]+)\3/g;

// An empty `import()` is prose in a message, not a call.
const DYNAMIC_IMPORT = /\bimport\s*\(\s*[^)\s]/;

// A quoted path that ends in .js and starts at a project's kixx/, app/, or
// plugins/ directory, or names a file at the project root.
const PROJECT_MODULE_LITERAL = /['"`]((?:kixx|app|plugins)\/[^'"`\s]*\.js|[a-z-]+-server\.js|virtual-hosts\.js)['"`]/g;


describe('devkit import hygiene', ({ before, describe, it }) => {
    let sourceFiles;
    let runtimeFiles;

    before(async () => {
        sourceFiles = await readSourceFiles(DEVKIT_DIRECTORY);

        // What runs when someone runs the CLI: the entry point, the commands,
        // and lib/. The runners load test and lint tools, and the skeleton is
        // a project's code, not the devkit's.
        runtimeFiles = sourceFiles.filter(({ pathname }) => {
            return pathname === 'kixx-dev.js' || pathname.startsWith('commands/') || pathname.startsWith('lib/');
        });
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

    it('statically imports only its own modules and node: built-ins', () => {
        assert(runtimeFiles.length > 50, 'reads the runtime modules');
        assertEqual('', findStaticImportProblems(runtimeFiles).join('; '));
    });

    it('has a dynamic import() only in the project tooling loader', () => {
        assertEqual(DYNAMIC_IMPORT_MODULES.join(','), findDynamicImportModules(runtimeFiles).join(','));
    });

    it('loads only the three core modules from a project', () => {
        const [ loader ] = runtimeFiles.filter(({ pathname }) => DYNAMIC_IMPORT_MODULES.includes(pathname));

        assertEqual(PROJECT_MODULES.join(','), findProjectModuleLiterals(loader.source).join(','));
    });

    // The checks above pass on today's source. These prove each one fails on
    // the mistake it is there to catch.
    describe('the checks', ({ it }) => {
        const fake = (pathname, source) => ({ pathname, source });

        it('accept imports of devkit modules, JSON, and node: built-ins', () => {
            const problems = findStaticImportProblems([
                fake('lib/a.js', [
                    'import fsp from \'node:fs/promises\';',
                    'import { b } from \'./project/b.js\';',
                    'import {',
                    '    c,',
                    '    d,',
                    '} from \'../commands/c.js\';',
                    'import manifest from \'../deno.json\' with { type: \'json\' };',
                    'export { e } from "./e.js";',
                    'import \'./side-effect.js\';',
                ].join('\n')),
                fake('kixx-dev.js', 'import runCli from \'./lib/run-cli.js\';'),
            ]);

            assertEqual('', problems.join('; '));
        });

        it('reject a static import that leaves devkit/', () => {
            const problems = findStaticImportProblems([
                fake('lib/a.js', 'import { parseJsonc } from \'../../kixx/config/parse-jsonc.js\';'),
                fake('commands/local/b.js', 'export { x } from \'../../../kixx/tooling/mod.js\';'),
                fake('kixx-dev.js', 'import \'../tools/build-project.js\';'),
                fake('lib/c.js', 'import {\n    a,\n} from \'/absolute/a.js\';'),
            ]);

            assertEqual(4, problems.length);
            assertEqual('lib/a.js imports "../../kixx/config/parse-jsonc.js", which is outside devkit/', problems[0]);
            assertMatches('commands/local/b.js', problems[1]);
            assertMatches('kixx-dev.js', problems[2]);
            assertMatches('lib/c.js', problems[3]);
        });

        it('reject a bare import that is not a node: built-in', () => {
            const problems = findStaticImportProblems([
                fake('lib/a.js', 'import { describe } from \'kixx-test\';\nimport fs from \'fs\';'),
            ]);

            assertEqual(2, problems.length);
            assertEqual('lib/a.js imports "kixx-test", which is not a node: built-in', problems[0]);
            assertEqual('lib/a.js imports "fs", which is not a node: built-in', problems[1]);
        });

        it('ignore an import named in a comment', () => {
            const source = [
                '/**',
                ' * @typedef {import(\'./types.js\').Thing} Thing',
                ' * import x from \'../../kixx/mod.js\';',
                ' */',
                '// import y from \'left-pad\'; and import(\'./z.js\')',
                'export const a = 1;',
            ].join('\n');

            assertEqual('', findStaticImportProblems([ fake('lib/a.js', source) ]).join('; '));
            assertEqual('', findDynamicImportModules([ fake('lib/a.js', source) ]).join(','));
        });

        it('find a second module with a dynamic import()', () => {
            const pathnames = findDynamicImportModules([
                fake('commands/render.js', 'const app = await import(appUrl);'),
                fake('lib/project/load-project-tooling.js', 'return import(url);'),
                fake('lib/quiet.js', 'const important = (x) => x;\nimportant(1);'),
                fake('lib/spaced.js', 'await import (\n    url\n);'),
                fake('lib/message.js', 'const message = \'Dynamic import() needs a literal.\';'),
            ]);

            assertEqual('commands/render.js,lib/project/load-project-tooling.js,lib/spaced.js', pathnames.join(','));
        });

        it('find a project module the loader has no business importing', () => {
            const source = [
                'const TOOLING_MODULE = \'kixx/tooling/mod.js\';',
                'const APP_MODULE = \'app/app.js\';',
                'const PLUGIN = `plugins/blog/plugin.js`;',
                'const ENTRY = "node-server.js";',
            ].join('\n');

            assertEqual(
                'app/app.js,kixx/tooling/mod.js,node-server.js,plugins/blog/plugin.js',
                findProjectModuleLiterals(source).join(','),
            );
        });
    });
});


// Block comments and whole-line comments hold JSDoc `import('...')` types and
// prose, which are not imports.
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

// Resolves a relative specifier against its importer, both as POSIX paths
// from devkit/. Null means it climbs out of devkit/.
function resolveInsideDevkit(importer, specifier) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
    return resolved.startsWith('..') ? null : resolved;
}

function findStaticImportProblems(files) {
    const problems = [];

    for (const { pathname, source } of files) {
        for (const match of stripComments(source).matchAll(STATIC_IMPORT)) {
            const specifier = match[2] ?? match[4];

            if (specifier.startsWith('.')) {
                if (resolveInsideDevkit(pathname, specifier) === null) {
                    problems.push(`${ pathname } imports "${ specifier }", which is outside devkit/`);
                }
            } else if (specifier.startsWith('/') || specifier.includes('://')) {
                problems.push(`${ pathname } imports "${ specifier }", which is outside devkit/`);
            } else if (!specifier.startsWith('node:')) {
                problems.push(`${ pathname } imports "${ specifier }", which is not a node: built-in`);
            }
        }
    }

    return problems;
}

function findDynamicImportModules(files) {
    return files
        .filter(({ source }) => DYNAMIC_IMPORT.test(stripComments(source)))
        .map(({ pathname }) => pathname);
}

function findProjectModuleLiterals(source) {
    return Array.from(stripComments(source).matchAll(PROJECT_MODULE_LITERAL), (match) => match[1]).sort();
}


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
