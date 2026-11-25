// Core is vendored as-is into projects (R1, CORE-1), so it must be
// self-contained: relative imports stay inside kixx/, node:* modules
// appear only in adapters, and nothing imports a module that is leaving
// core except the known edges below.
//
// Adapters are reached only through generated registries and entry points
// (TECH-3). So no core module outside adapters/ imports one: it would carry
// a platform's code into every target's bundle.
//
// Unit tests never run the platform (QA-7, D56). So cloudflare:* modules
// appear only in the Durable Object shells listed below, each shell is
// only a binding to a plain class, and nothing a unit test imports
// reaches a shell or a cloudflare:* module. Core's manifest declares
// exactly those shells, because a generated registry exports what the
// manifest declares.
//
// The probe in test-app/probe/ is bundled into every target the
// integration suite runs on (QA-8). So everything it reaches imports by
// relative path only, and nothing under test-app/ imports a cloudflare:*
// module.
//
// When a section extracts a module or removes an edge, delete its entry
// from LEAVING_CORE or KNOWN_EDGES. The rule "lists no module or edge that
// is already gone" fails until you do.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';


const REPOSITORY_DIRECTORY = fileURLToPath(new URL('../../', import.meta.url));
const CORE_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'kixx/');
const CORE_MANIFEST_FILE = path.join(CORE_DIRECTORY, 'plugin.json');
const TEST_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'test/');
const TEST_APP_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'test-app/');
const PROBE_DIRECTORY = path.join(TEST_APP_DIRECTORY, 'probe/');

// Modules still in core that a later section removes.
const LEAVING_CORE = {
    'document-store': 'S25',
    'jobs': 'S28',
    'object-store': 'S27',
    'permissions': 'S29',
};

// Imports from the rest of core into a module in LEAVING_CORE, as
// core-relative paths.
const KNOWN_EDGES = [
    { from: 'context/application-context.js', to: 'jobs/job-logger.js', removedBy: 'S28' },
];

// Durable Object classes, as core-relative paths. These are the only core
// files that import a cloudflare:* module. List a new shell here, and
// declare it in core's manifest (kixx/plugin.json).
//
// Core has no Cloudflare entry point to list. One would export a shell, so
// the rule that no unit test reaches a shell keeps tests away from it too.
const DURABLE_OBJECT_SHELLS = [
    'adapters/cloudflare/content-store/lib/content-addressable-index-store.js',
];

// Static import and export specifiers, including multi-line import lists.
// Excluding `(` and `=` keeps it from matching `export function f(…)`,
// `export const x = '…'`, and JSDoc `import('…')` type references.
const SPECIFIER_PATTERN = /^[ \t]*(?:import[ \t]*|(?:import|export)\b[^'";()=]*?\bfrom[ \t]*)(['"])([^'"]+)\1/gm;


export function extractSpecifiers(source) {
    return Array.from(source.matchAll(SPECIFIER_PATTERN), (match) => match[2]);
}


describe('import hygiene', ({ it }) => {
    const imports = readCoreImports();

    it('extracts only static import and export specifiers', () => {
        const sample = [
            'import {',
            '    a,',
            '    b,',
            "} from './multi-line.js';",
            "export { c } from '../re-export.js';",
            "import './side-effect.js';",
            "export const NAME = 'not-a-specifier';",
            '/**',
            " * @param {import('stream').Readable} stream",
            ' */',
        ].join('\n');

        assertEqual(
            './multi-line.js,../re-export.js,./side-effect.js',
            extractSpecifiers(sample).join(','),
        );
    });

    it('resolves every relative import inside core', () => {
        const violations = imports.filter(({ specifier, target }) => {
            return specifier.startsWith('.') && (!isInsideCore(target) || !fs.existsSync(target));
        });

        assertEqual('', formatViolations(violations));
    });

    it('imports node:* modules only in adapters, and no bare specifier', () => {
        const violations = imports.filter(({ file, specifier }) => {
            // cloudflare:* modules have their own rule, next.
            if (specifier.startsWith('.') || specifier.startsWith('cloudflare:')) {
                return false;
            }
            return !specifier.startsWith('node:') || !file.startsWith('adapters/');
        });

        assertEqual('', formatViolations(violations));
    });

    it('imports no adapter from core outside adapters/', () => {
        // A file that imports a Node.js adapter holds no node:* specifier of
        // its own, so the rule above would not catch it.
        const violations = imports.filter(({ file, specifier, target }) => {
            return specifier.startsWith('.')
                && !file.startsWith('adapters/')
                && isInsideCore(target)
                && toCorePath(target).startsWith('adapters/');
        });

        assertEqual('', formatViolations(violations));
    });

    it('imports cloudflare:* modules only in Durable Object shells', () => {
        const cloudflareImports = imports.filter(({ specifier }) => specifier.startsWith('cloudflare:'));

        // The importers must be exactly the listed shells, so an entry that
        // no longer imports a cloudflare:* module fails too.
        const problems = cloudflareImports
            .filter(({ file }) => !DURABLE_OBJECT_SHELLS.includes(file))
            .map(({ file, specifier }) => `${ file } -> ${ specifier } (not in DURABLE_OBJECT_SHELLS)`);

        for (const shell of DURABLE_OBJECT_SHELLS) {
            if (!cloudflareImports.some(({ file }) => file === shell)) {
                problems.push(`DURABLE_OBJECT_SHELLS lists ${ shell }, which imports no cloudflare:* module`);
            }
        }

        assertEqual('', problems.join('\n'));
    });

    it('keeps every Durable Object shell to cloudflare:workers and relative imports', () => {
        const violations = imports.filter(({ file, specifier }) => {
            return DURABLE_OBJECT_SHELLS.includes(file)
                && !specifier.startsWith('.')
                && specifier !== 'cloudflare:workers';
        });

        assertEqual('', formatViolations(violations));
    });

    it('declares exactly the Durable Object shells in core\'s manifest', () => {
        // A shell no manifest declares would never be exported from a Worker,
        // and a declared module that isn't a listed shell would escape the
        // thin-shell rule above.
        const manifest = JSON.parse(fs.readFileSync(CORE_MANIFEST_FILE, 'utf8'));
        const declared = manifest.cloudflare.durableObjects.map(({ module }) => module.replace(/^\.\//, ''));

        assertEqual(DURABLE_OBJECT_SHELLS.slice().sort().join('\n'), declared.sort().join('\n'));
    });

    it('imports modules leaving core only through known edges', () => {
        const violations = imports.filter(({ file, specifier, target }) => {
            if (!specifier.startsWith('.') || leavingModuleOf(file) || !isInsideCore(target)) {
                return false;
            }
            const to = toCorePath(target);
            if (!leavingModuleOf(to)) {
                return false;
            }
            return !KNOWN_EDGES.some((edge) => edge.from === file && edge.to === to);
        });

        assertEqual('', formatViolations(violations));
    });

    it('lists no module or edge that is already gone', () => {
        const stale = [];

        for (const [ name, section ] of Object.entries(LEAVING_CORE)) {
            if (!fs.existsSync(path.join(CORE_DIRECTORY, name))) {
                stale.push(`LEAVING_CORE['${ name }'] is gone; ${ section } must delete the entry`);
            }
        }

        for (const edge of KNOWN_EDGES) {
            const exists = imports.some(({ file, target }) => {
                return file === edge.from && isInsideCore(target) && toCorePath(target) === edge.to;
            });
            if (!exists) {
                stale.push(`KNOWN_EDGES ${ edge.from } -> ${ edge.to } is gone; ${ edge.removedBy } must delete the entry`);
            }
        }

        assertEqual('', stale.join('\n'));
    });

    it('reaches no cloudflare:* module or Durable Object shell from a unit test', () => {
        const violations = [];

        // Every .js file under test/ is a starting point: test files, and the
        // fakes and suites they share.
        for (const { file, specifiers, chain } of readImportGraph(listJavaScriptFiles(TEST_DIRECTORY))) {
            const trail = chain.map(toRepositoryPath).join(' -> ');

            if (DURABLE_OBJECT_SHELLS.includes(toCorePath(file))) {
                violations.push({ file: trail, specifier: '(a Durable Object shell)' });
            }

            for (const specifier of specifiers) {
                if (specifier.startsWith('cloudflare:')) {
                    violations.push({ file: trail, specifier });
                }
            }
        }

        assertEqual('', formatViolations(violations));
    });

    it('reaches only relative imports from the probe', () => {
        const violations = [];

        // The same build of the probe runs on Cloudflare, Node.js, and Deno,
        // so it can hold no package and no platform module. That covers the
        // probe's own files, the suites it registers, and the core modules
        // those suites use.
        for (const { specifiers, chain } of readImportGraph(listJavaScriptFiles(PROBE_DIRECTORY))) {
            const trail = chain.map(toRepositoryPath).join(' -> ');

            for (const specifier of specifiers) {
                if (!specifier.startsWith('.')) {
                    violations.push({ file: trail, specifier });
                }
            }
        }

        assertEqual('', formatViolations(violations));
    });

    it('imports no cloudflare:* module in test-app/', () => {
        // The runner, its helpers, and the integration tests run on a laptop.
        // A test app's Cloudflare entry point needs its own list here when
        // the first test app exists.
        const violations = listJavaScriptFiles(TEST_APP_DIRECTORY).flatMap((filepath) => {
            return extractSpecifiers(fs.readFileSync(filepath, 'utf8'))
                .filter((specifier) => specifier.startsWith('cloudflare:'))
                .map((specifier) => ({ file: toRepositoryPath(filepath), specifier }));
        });

        assertEqual('', formatViolations(violations));
    });
});


// Returns one record per specifier in every .js file under core, vendor/
// included: vendored code ships too.
function readCoreImports() {
    return listJavaScriptFiles(CORE_DIRECTORY).flatMap((filepath) => {
        const file = toCorePath(filepath);
        const source = fs.readFileSync(filepath, 'utf8');

        return extractSpecifiers(source).map((specifier) => {
            const target = specifier.startsWith('.')
                ? path.resolve(path.dirname(filepath), specifier)
                : null;
            return { file, specifier, target };
        });
    });
}

// Follows static relative specifiers from the entry files (absolute paths)
// to every file they reach, reading each file once. Returns one record per
// reached file: its path, its specifiers, and the chain of files that led to
// it, starting at an entry file.
//
// A dynamic import() isn't followed, because SPECIFIER_PATTERN doesn't
// match one.
function readImportGraph(entryFiles) {
    const graph = new Map();
    const queue = entryFiles.map((filepath) => [ filepath ]);

    while (queue.length > 0) {
        const chain = queue.shift();
        const file = chain.at(-1);

        if (graph.has(file)) {
            continue;
        }

        const specifiers = extractSpecifiers(fs.readFileSync(file, 'utf8'));
        graph.set(file, { file, specifiers, chain });

        for (const specifier of specifiers) {
            if (specifier.startsWith('.')) {
                queue.push([ ...chain, path.resolve(path.dirname(file), specifier) ]);
            }
        }
    }

    return Array.from(graph.values());
}

// Absolute paths of every .js file under the directory, at any depth.
function listJavaScriptFiles(directory) {
    return fs.readdirSync(directory, { recursive: true })
        .filter((name) => name.endsWith('.js'))
        .map((name) => path.join(directory, name))
        .sort();
}

function isInsideCore(filepath) {
    const relativePath = path.relative(CORE_DIRECTORY, filepath);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function toCorePath(filepath) {
    return path.relative(CORE_DIRECTORY, filepath).split(path.sep).join('/');
}

function toRepositoryPath(filepath) {
    return path.relative(REPOSITORY_DIRECTORY, filepath).split(path.sep).join('/');
}

function leavingModuleOf(corePath) {
    const name = corePath.split('/')[0];
    return Object.hasOwn(LEAVING_CORE, name) ? name : null;
}

function formatViolations(violations) {
    return violations.map(({ file, specifier }) => `${ file } -> ${ specifier }`).join('\n');
}
