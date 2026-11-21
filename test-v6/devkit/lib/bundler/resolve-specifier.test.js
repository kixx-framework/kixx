import { describe, MockTracker } from 'kixx-test';
import { assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import resolveSpecifier from '../../../lib/bundler/resolve-specifier.js';

const BASE_DIRECTORY = '/app';
const IMPORTER_FILEPATH = '/app/index.js';

describe('resolveSpecifier', ({ it }) => {
    it('leaves declared bare specifiers external without filesystem access', async () => {
        const fileSystem = makeFileSystem({});

        const nodeResult = await resolveSpecifier(makeArgs({
            specifier: 'node:fs',
            externals: [ 'node:', 'cloudflare:workers' ],
            fileSystem,
        }));
        const exactResult = await resolveSpecifier(makeArgs({
            specifier: 'cloudflare:workers',
            externals: [ 'node:', 'cloudflare:workers' ],
            fileSystem,
        }));

        assertEqual('external', nodeResult.type);
        assertEqual('external', exactResult.type);
        assertEqual(0, fileSystem.calls.length);
    });

    it('rejects undeclared bare specifiers without filesystem access', async () => {
        const fileSystem = makeFileSystem({});
        const result = await resolveSpecifier(makeArgs({
            specifier: 'lodash',
            fileSystem,
        }));

        assertError(result, 'not declared external');
        assertEqual(0, fileSystem.calls.length);
    });

    it('returns an internal module keyed from its logical path', async () => {
        const fileSystem = makeFileSystem({ '/app/lib/value.mjs': 'export default 1;' });
        const result = await resolveSpecifier(makeArgs({
            specifier: './lib/value.mjs',
            fileSystem,
        }));

        assertEqual('internal', result.type);
        assertEqual('/app/lib/value.mjs', result.filepath);
        assertEqual('./lib/value.mjs', result.name);
    });

    it('rejects unsupported extensions before filesystem access', async () => {
        const fileSystem = makeFileSystem({});
        const cjsResult = await resolveSpecifier(makeArgs({ specifier: './legacy.cjs', fileSystem }));
        const jsonResult = await resolveSpecifier(makeArgs({ specifier: './data.json', fileSystem }));
        const extensionlessResult = await resolveSpecifier(makeArgs({ specifier: './directory', fileSystem }));

        assertError(cjsResult, 'CommonJS');
        assertError(jsonResult, 'Unsupported module type');
        assertError(extensionlessResult, 'Unsupported module type');
        assertEqual(0, fileSystem.calls.length);
    });

    it('rejects paths outside the base directory and logical node_modules paths', async () => {
        const fileSystem = makeFileSystem({});
        const escapedResult = await resolveSpecifier(makeArgs({
            specifier: '../shared/value.js',
            fileSystem,
        }));
        const nodeModulesResult = await resolveSpecifier(makeArgs({
            specifier: './node_modules/value.js',
            fileSystem,
        }));

        assertError(escapedResult, 'outside the bundle base directory');
        assertError(nodeModulesResult, 'node_modules');
        assertEqual(0, fileSystem.calls.length);
    });

    it('does not confuse a sibling base prefix or ordinary directory name with node_modules', async () => {
        const fileSystem = makeFileSystem({
            '/application/value.js': 'export default 1;',
            '/app/my_node_modules_helper/value.js': 'export default 2;',
        });
        const siblingResult = await resolveSpecifier(makeArgs({
            specifier: '../application/value.js',
            fileSystem,
        }));
        const helperResult = await resolveSpecifier(makeArgs({
            specifier: './my_node_modules_helper/value.js',
            fileSystem,
        }));

        assertError(siblingResult, 'outside the bundle base directory');
        assertEqual('internal', helperResult.type);
    });

    it('rejects node_modules reached through a real path', async () => {
        const fileSystem = makeFileSystem(
            { '/app/vendor/value.js': 'export default 1;' },
            { '/app/vendor/value.js': '/app/node_modules/package/value.js' },
        );
        const result = await resolveSpecifier(makeArgs({
            specifier: './vendor/value.js',
            fileSystem,
        }));

        assertError(result, 'points into node_modules');
    });

    it('rejects mismatched casing but accepts ordinary symlinks', async () => {
        const caseFileSystem = makeFileSystem(
            { '/app/lib/value.js': 'export default 1;' },
            { '/app/lib/value.js': '/app/lib/Value.js' },
        );
        const symlinkFileSystem = makeFileSystem(
            { '/app/link/value.js': 'export default 1;' },
            { '/app/link/value.js': '/elsewhere/value.js' },
        );
        const caseResult = await resolveSpecifier(makeArgs({
            specifier: './lib/value.js',
            fileSystem: caseFileSystem,
        }));
        const symlinkResult = await resolveSpecifier(makeArgs({
            specifier: './link/value.js',
            fileSystem: symlinkFileSystem,
        }));

        assertError(caseResult, '/app/lib/Value.js');
        assertEqual('internal', symlinkResult.type);
        assertEqual('./link/value.js', symlinkResult.name);
    });

    it('does not call the filesystem for a string-level rejection', async () => {
        const tracker = new MockTracker();
        const fileSystem = makeFileSystem({});

        tracker.method(fileSystem, 'isFile');
        tracker.method(fileSystem, 'realpath');

        await resolveSpecifier(makeArgs({ specifier: './data.json', fileSystem }));

        assertEqual(0, fileSystem.isFile.mock.callCount());
        assertEqual(0, fileSystem.realpath.mock.callCount());
        tracker.reset();
    });
});

function makeArgs(overrides) {
    return {
        specifier: './value.js',
        importer: './index.js',
        importerFilepath: IMPORTER_FILEPATH,
        baseDirectory: BASE_DIRECTORY,
        line: 3,
        column: 7,
        ...overrides,
    };
}

function makeFileSystem(files, realpathOverrides = {}) {
    const calls = [];

    return {
        calls,
        async readFile(filepath) {
            calls.push([ 'readFile', filepath ]);
            return files[filepath];
        },
        async realpath(filepath) {
            calls.push([ 'realpath', filepath ]);
            return realpathOverrides[filepath] ?? filepath;
        },
        async isFile(filepath) {
            calls.push([ 'isFile', filepath ]);
            return Object.hasOwn(files, filepath);
        },
    };
}

function assertError(result, message) {
    assertEqual('error', result.type);
    assertMatches(message, result.diagnostic.message);
    assertEqual('./index.js', result.diagnostic.importer);
    assertEqual(3, result.diagnostic.line);
    assertEqual(7, result.diagnostic.column);
}
