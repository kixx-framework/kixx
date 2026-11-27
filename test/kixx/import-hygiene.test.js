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
// The fixture project under test/fixtures/ holds what a real project
// holds, so two of its files can load only on Cloudflare. They are listed
// in CLOUDFLARE_ONLY_MODULES, and no unit test reaches one. Its entry
// points are listed in ENTRY_POINTS: no test file reaches one, and each
// imports exactly what a thin shell may (PLUG-5). Its platform-neutral
// files stay platform-neutral.
//
// The project skeleton in devkit/templates/project/ is what a new project
// is copied from, so the same rules hold for it: its entry points are thin
// shells no test reaches, its Cloudflare entry point is Cloudflare-only, and
// every import of ./kixx/ names a module core really has. It holds no core
// and no generated file of its own.
//
// Code in a project's app/, and a plugin's code outside its adapters/, never
// imports a platform module or a platform adapter (CORE-5). The rule is
// tested here, for the skeleton and for every first-party plugin. Nothing
// enforces it inside a project.
//
// The probe in test-app/probe/ is bundled into every target the
// integration suite runs on (QA-8). So everything it reaches imports by
// relative path only, and nothing under test-app/ imports a cloudflare:*
// module. The test-only plugin that mounts it,
// test-app/integration-probe/, is held to a plugin's rules: platform-neutral
// outside its adapters/, relative imports only but for node:* in its
// Node.js adapter, and no node:* reached from its Cloudflare adapter. The
// built test app in test-app/build/ is never read.
//
// The content compiler runs in a command line tool, a server, and a Worker,
// and a tool loads it through the tooling entry. So nothing either entry
// reaches imports a platform module, a package, or an adapter.
//
// CORE-1 names what core contains. The top level of kixx/ is pinned to
// that list, the operator-approved additions, and LEAVING_CORE.
//
// When a section extracts a module or removes an edge, delete its entry
// from LEAVING_CORE or KNOWN_EDGES. The rule "lists no module or edge that
// is already gone" fails until you do.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { extractSpecifiers, readImportGraph } from '../../tools/lib/import-graph.js';


const REPOSITORY_DIRECTORY = fileURLToPath(new URL('../../', import.meta.url));
const CORE_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'kixx/');
const CORE_MANIFEST_FILE = path.join(CORE_DIRECTORY, 'plugin.json');
const TEST_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'test/');
const TEST_APP_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'test-app/');
const PROBE_DIRECTORY = path.join(TEST_APP_DIRECTORY, 'probe/');
const PLUGINS_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'plugins/');

// The integration suite's test-only plugin, and the test app built from it.
// The build is git-ignored output: a copy of files checked where they live.
const INTEGRATION_PROBE_DIRECTORY = path.join(TEST_APP_DIRECTORY, 'integration-probe/');
const TEST_APP_BUILD_DIRECTORY = path.join(TEST_APP_DIRECTORY, 'build/');

// The project skeleton. It holds no core: a project built from it has core
// at ./kixx/, so its imports of ./kixx/ are resolved to core here.
const SKELETON_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'devkit/templates/project/');
const SKELETON_CORE_DIRECTORY = path.join(SKELETON_DIRECTORY, 'kixx/');

// What core's directory holds, at its top level, is these three lists and
// nothing else. A new entry fails "holds exactly the modules CORE-1 allows"
// until it is listed with its reason.
//
// The modules CORE-1 names, with core's manifest.
const CORE_1_MODULES = [
    'adapters',
    'assertions',
    'config',
    'content-addressable-store',
    'content-compiler',
    'context',
    'errors',
    'http-router',
    'hyperview',
    'key-value-store',
    'logger',
    'plugin.json',
    'publishing-api',
    'static-assets',
    'utils',
    'vendor',
];

// Modules the operator approved in core beyond CORE-1's list, and why
// each is there.
const APPROVED_CORE_ADDITIONS = {
    'code-fingerprint': 'the publish gates compare a commit\'s code with a build\'s',
    'deploy-key': 'authenticates the Publishing API',
    'publish-gates': 'what the Publishing API requires of a build write',
    'tooling': 'the generator and compiler entry a project runs from its own core',
};

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

// Files that only Cloudflare can load, as repository-relative paths: a
// Cloudflare entry point, and a generated registry that exports Durable
// Object shells. No unit test may reach one. List a file here when a fixture
// or a project template gains one.
const CLOUDFLARE_ONLY_MODULES = [
    'test/fixtures/project/cloudflare-server.js',
    'test/fixtures/project/cloudflare-durable-objects.generated.js',
    'devkit/templates/project/cloudflare-server.js',
];

// Entry points, as repository-relative paths. An entry point starts a server
// when it loads, so no test file may import one: the integration suite
// covers them. List the entry points of a fixture or a project template here.
const ENTRY_POINTS = [
    'test/fixtures/project/node-server.js',
    'test/fixtures/project/cloudflare-server.js',
    'devkit/templates/project/node-server.js',
    'devkit/templates/project/cloudflare-server.js',
];

const FIXTURE_PROJECT_DIRECTORY = path.join(TEST_DIRECTORY, 'fixtures/project/');

// Entry modules that must load on every runtime, as core-relative paths.
// Nothing they reach may import a node:* or cloudflare:* module, a package,
// or an adapter.
const PLATFORM_NEUTRAL_ENTRIES = [
    'code-fingerprint/mod.js',
    'content-compiler/mod.js',
    'tooling/mod.js',
];

// Everything each of the fixture's entry points imports, in order. An entry
// point names no plugin and no service: it imports one core server module,
// the generated registries, the project's virtual hosts, and its app.
const FIXTURE_ENTRY_POINT_IMPORTS = {
    'node-server.js': [
        '../../../kixx/adapters/node/server/lib/node-server.js',
        './node-registry.generated.js',
        './virtual-hosts.js',
        './app/app.js',
    ],
    'cloudflare-server.js': [
        'cloudflare:workers',
        '../../../kixx/adapters/cloudflare/server/lib/cloudflare-worker.js',
        './cloudflare-config.generated.js',
        './cloudflare-registry.generated.js',
        './virtual-hosts.js',
        './app/app.js',
        './cloudflare-durable-objects.generated.js',
    ],
};

// The same lists for the skeleton, where core is at ./kixx/. They are the
// entry points in plugins/README.md ("Entry Points").
const SKELETON_ENTRY_POINT_IMPORTS = {
    'node-server.js': [
        './kixx/adapters/node/server/lib/node-server.js',
        './node-registry.generated.js',
        './virtual-hosts.js',
        './app/app.js',
    ],
    'cloudflare-server.js': [
        'cloudflare:workers',
        './kixx/adapters/cloudflare/server/lib/cloudflare-worker.js',
        './cloudflare-config.generated.js',
        './cloudflare-registry.generated.js',
        './virtual-hosts.js',
        './app/app.js',
        './cloudflare-durable-objects.generated.js',
    ],
};

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

    it('reaches no platform module, package, or adapter from the content compiler or the tooling entry', () => {
        // The rules above imply this today. This one states it for the
        // compiler, follows its imports through the rest of core, and holds
        // if those rules change.
        const violations = [];
        const entryFiles = PLATFORM_NEUTRAL_ENTRIES.map((entry) => path.join(CORE_DIRECTORY, entry));

        for (const { file, specifiers, chain } of readImportGraph(entryFiles)) {
            const trail = chain.map(toRepositoryPath).join(' -> ');

            if (!isInsideCore(file)) {
                violations.push({ file: trail, specifier: '(a file outside core)' });
            } else if (toCorePath(file).startsWith('adapters/')) {
                violations.push({ file: trail, specifier: '(an adapter)' });
            }

            for (const specifier of specifiers) {
                if (!specifier.startsWith('.')) {
                    violations.push({ file: trail, specifier });
                }
            }
        }

        assertEqual('', formatViolations(violations));
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

    it('holds exactly the modules CORE-1 allows', () => {
        const allowed = [
            ...CORE_1_MODULES,
            ...Object.keys(APPROVED_CORE_ADDITIONS),
            ...Object.keys(LEAVING_CORE),
        ].sort();

        assertEqual(allowed.join('\n'), fs.readdirSync(CORE_DIRECTORY).sort().join('\n'));
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
        // fakes, suites, and fixture files they share. The files only
        // Cloudflare can load are not, and reaching one is a violation.
        const entryFiles = listJavaScriptFiles(TEST_DIRECTORY).filter((filepath) => !isCloudflareOnlyModule(filepath));

        for (const { file, specifiers, chain } of readImportGraph(entryFiles, isCloudflareOnlyModule)) {
            const trail = chain.map(toRepositoryPath).join(' -> ');

            if (isCloudflareOnlyModule(file)) {
                violations.push({ file: trail, specifier: '(a module only Cloudflare can load)' });
            }

            if (isDurableObjectShell(file)) {
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

    it('lists only modules that Cloudflare alone can load', () => {
        const problems = [];

        for (const entry of CLOUDFLARE_ONLY_MODULES) {
            const filepath = path.join(REPOSITORY_DIRECTORY, entry);

            if (!fs.existsSync(filepath)) {
                problems.push(`CLOUDFLARE_ONLY_MODULES lists ${ entry }, which doesn't exist`);
                continue;
            }

            // What makes a file Cloudflare-only is a cloudflare:* import or a
            // Durable Object shell. An entry with neither is stale.
            const needsCloudflare = extractSpecifiers(fs.readFileSync(filepath, 'utf8')).some((specifier) => {
                return specifier.startsWith('cloudflare:')
                    || (specifier.startsWith('.') && isDurableObjectShell(path.resolve(path.dirname(filepath), specifier)));
            });

            if (!needsCloudflare) {
                problems.push(`CLOUDFLARE_ONLY_MODULES lists ${ entry }, which imports no cloudflare:* module and no Durable Object shell`);
            }
        }

        assertEqual('', problems.join('\n'));
    });

    it('reaches no entry point from a test file', () => {
        const testFiles = listJavaScriptFiles(TEST_DIRECTORY).filter((filepath) => filepath.endsWith('.test.js'));
        const stopAt = (filepath) => isEntryPoint(filepath) || isCloudflareOnlyModule(filepath);

        const violations = readImportGraph(testFiles, stopAt)
            .filter(({ file }) => isEntryPoint(file))
            .map(({ chain }) => ({ file: chain.map(toRepositoryPath).join(' -> '), specifier: '(an entry point)' }));

        assertEqual('', formatViolations(violations));
    });

    it('keeps the fixture\'s entry points to the imports of a thin shell', () => {
        // The lists are compared exactly, so an entry point that gains an
        // import, and with it a feature of its own, fails here.
        for (const [ fileName, expected ] of Object.entries(FIXTURE_ENTRY_POINT_IMPORTS)) {
            const source = fs.readFileSync(path.join(FIXTURE_PROJECT_DIRECTORY, fileName), 'utf8');

            assertEqual(expected.join('\n'), extractSpecifiers(source).join('\n'), fileName);
        }

        // Every listed entry point of the fixture has a list above.
        const listed = ENTRY_POINTS
            .filter((entry) => isInsideDirectory(FIXTURE_PROJECT_DIRECTORY, path.join(REPOSITORY_DIRECTORY, entry)))
            .map((entry) => path.basename(entry));

        assertEqual(Object.keys(FIXTURE_ENTRY_POINT_IMPORTS).sort().join(','), listed.sort().join(','));
    });

    it('keeps the skeleton\'s entry points to the imports of a thin shell', () => {
        for (const [ fileName, expected ] of Object.entries(SKELETON_ENTRY_POINT_IMPORTS)) {
            const source = fs.readFileSync(path.join(SKELETON_DIRECTORY, fileName), 'utf8');

            assertEqual(expected.join('\n'), extractSpecifiers(source).join('\n'), fileName);
        }

        // Every listed entry point of the skeleton has a list above.
        const listed = ENTRY_POINTS
            .filter((entry) => isInsideDirectory(SKELETON_DIRECTORY, path.join(REPOSITORY_DIRECTORY, entry)))
            .map((entry) => path.basename(entry));

        assertEqual(Object.keys(SKELETON_ENTRY_POINT_IMPORTS).sort().join(','), listed.sort().join(','));
    });

    it('holds no generated file and no core in the skeleton', () => {
        // The scaffold copies core in and runs the generator. A copy kept
        // here would drift from what they write.
        const found = fs.readdirSync(SKELETON_DIRECTORY, { recursive: true })
            .map((name) => name.split(path.sep).join('/'))
            .filter((name) => {
                return name.endsWith('.generated.js')
                    || path.posix.basename(name) === 'example.env.secrets'
                    || name === 'kixx';
            });

        assertEqual('', found.join('\n'));
    });

    it('resolves every import of core from the skeleton', () => {
        // A core module that moves breaks the build here, and not in a
        // project generated from the skeleton.
        const violations = listJavaScriptFiles(SKELETON_DIRECTORY).flatMap((filepath) => {
            return extractSpecifiers(fs.readFileSync(filepath, 'utf8'))
                .filter((specifier) => specifier.startsWith('.'))
                .map((specifier) => ({ specifier, target: path.resolve(path.dirname(filepath), specifier) }))
                .filter(({ target }) => isInsideDirectory(SKELETON_CORE_DIRECTORY, target))
                .filter(({ target }) => !fs.existsSync(resolveSkeletonCore(target)))
                .map(({ specifier }) => ({ file: toRepositoryPath(filepath), specifier }));
        });

        assertEqual('', formatViolations(violations));
    });

    it('imports no platform module or adapter from the skeleton\'s app code or a plugin\'s platform-neutral code (CORE-5)', () => {
        const violations = [];

        const entryFiles = [
            ...listJavaScriptFiles(path.join(SKELETON_DIRECTORY, 'app/')),
            path.join(SKELETON_DIRECTORY, 'virtual-hosts.js'),
            ...listPluginPlatformNeutralFiles(),
            ...listPlatformNeutralFiles(INTEGRATION_PROBE_DIRECTORY),
        ];

        // A generated file isn't in the skeleton, and isn't app code.
        const stopAt = (filepath) => filepath.endsWith('.generated.js') && isInsideDirectory(SKELETON_DIRECTORY, filepath);

        const resolve = (file, specifier) => resolveSkeletonCore(path.resolve(path.dirname(file), specifier));

        for (const { file, specifiers, chain } of readImportGraph(entryFiles, stopAt, resolve)) {
            const trail = chain.map(toRepositoryPath).join(' -> ');

            if (isInsideCore(file) && toCorePath(file).startsWith('adapters/')) {
                violations.push({ file: trail, specifier: '(an adapter)' });
            }

            for (const specifier of specifiers) {
                if (specifier.startsWith('node:') || specifier.startsWith('cloudflare:')) {
                    violations.push({ file: trail, specifier });
                }
            }
        }

        assertEqual('', formatViolations(violations));
    });

    it('keeps the fixture\'s platform-neutral files platform-neutral', () => {
        const violations = [];

        // The Cloudflare registry must load in a Worker, so nothing it
        // reaches may need Node.js.
        collectPlatformImports(violations, 'cloudflare-registry.generated.js', [ 'node:' ]);

        // Routes and virtual hosts load on every target.
        collectPlatformImports(violations, 'routes.generated.js', [ 'node:', 'cloudflare:' ]);
        collectPlatformImports(violations, 'virtual-hosts.js', [ 'node:', 'cloudflare:' ]);

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

    it('reaches only relative imports from the integration-probe plugin, but for node:* in its Node.js adapter', () => {
        const violations = [];
        const nodeAdapterDirectory = path.join(INTEGRATION_PROBE_DIRECTORY, 'adapters/node/');

        // The plugin is bundled into the test app's Worker and copied into
        // its Node.js project, so it can hold no package. What core's own
        // adapters import is core's to check.
        for (const { file, specifiers, chain } of readImportGraph(listJavaScriptFiles(INTEGRATION_PROBE_DIRECTORY))) {
            if (isInsideCore(file) && toCorePath(file).startsWith('adapters/')) {
                continue;
            }

            const trail = chain.map(toRepositoryPath).join(' -> ');

            for (const specifier of specifiers) {
                const allowed = specifier.startsWith('.')
                    || (specifier.startsWith('node:') && isInsideDirectory(nodeAdapterDirectory, file));

                if (!allowed) {
                    violations.push({ file: trail, specifier });
                }
            }
        }

        assertEqual('', formatViolations(violations));
    });

    it('reaches no node:* module from the integration-probe plugin\'s Cloudflare adapter', () => {
        const violations = [];
        const entryFiles = listJavaScriptFiles(path.join(INTEGRATION_PROBE_DIRECTORY, 'adapters/cloudflare/'));

        // It is bundled into a Worker with everything it reaches.
        for (const { specifiers, chain } of readImportGraph(entryFiles)) {
            const trail = chain.map(toRepositoryPath).join(' -> ');

            for (const specifier of specifiers) {
                if (specifier.startsWith('node:')) {
                    violations.push({ file: trail, specifier });
                }
            }
        }

        assertEqual('', formatViolations(violations));
    });

    it('imports no cloudflare:* module in test-app/', () => {
        // The runner, its helpers, the integration tests, and the test-only
        // plugin. The built test app is skipped: its Cloudflare entry point
        // is the skeleton's, which CLOUDFLARE_ONLY_MODULES lists.
        const files = listJavaScriptFiles(TEST_APP_DIRECTORY).filter((filepath) => {
            return !isInsideDirectory(TEST_APP_BUILD_DIRECTORY, filepath);
        });

        const violations = files.flatMap((filepath) => {
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

// Maps a path inside the skeleton's ./kixx/, which the skeleton doesn't
// hold, to the same path in core. Any other path is returned unchanged.
function resolveSkeletonCore(filepath) {
    if (!isInsideDirectory(SKELETON_CORE_DIRECTORY, filepath)) {
        return filepath;
    }

    return path.join(CORE_DIRECTORY, path.relative(SKELETON_CORE_DIRECTORY, filepath));
}

// Every .js file of each first-party plugin outside its adapters/, as
// absolute paths. A plugin is a directory under plugins/ with a plugin.json.
function listPluginPlatformNeutralFiles() {
    if (!fs.existsSync(PLUGINS_DIRECTORY)) {
        return [];
    }

    return fs.readdirSync(PLUGINS_DIRECTORY, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(PLUGINS_DIRECTORY, entry.name))
        .filter((directory) => fs.existsSync(path.join(directory, 'plugin.json')))
        .flatMap(listPlatformNeutralFiles);
}

// Every .js file of a plugin outside its adapters/, as absolute paths.
function listPlatformNeutralFiles(pluginDirectory) {
    return listJavaScriptFiles(pluginDirectory).filter((filepath) => {
        return !isInsideDirectory(path.join(pluginDirectory, 'adapters/'), filepath);
    });
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

// Adds a violation for each specifier with one of the prefixes, in any file
// the fixture file reaches.
function collectPlatformImports(violations, fixtureFileName, prefixes) {
    const entryFile = path.join(FIXTURE_PROJECT_DIRECTORY, fixtureFileName);

    for (const { specifiers, chain } of readImportGraph([ entryFile ])) {
        const trail = chain.map(toRepositoryPath).join(' -> ');

        for (const specifier of specifiers) {
            if (prefixes.some((prefix) => specifier.startsWith(prefix))) {
                violations.push({ file: trail, specifier });
            }
        }
    }
}

function isInsideDirectory(directory, filepath) {
    const relativePath = path.relative(directory, filepath);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isEntryPoint(filepath) {
    return ENTRY_POINTS.includes(toRepositoryPath(filepath));
}

function isDurableObjectShell(filepath) {
    return isInsideCore(filepath) && DURABLE_OBJECT_SHELLS.includes(toCorePath(filepath));
}

function isCloudflareOnlyModule(filepath) {
    return CLOUDFLARE_ONLY_MODULES.includes(toRepositoryPath(filepath));
}

function leavingModuleOf(corePath) {
    const name = corePath.split('/')[0];
    return Object.hasOwn(LEAVING_CORE, name) ? name : null;
}

function formatViolations(violations) {
    return violations.map(({ file, specifier }) => `${ file } -> ${ specifier }`).join('\n');
}
