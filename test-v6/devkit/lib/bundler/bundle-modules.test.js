import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import bundleModules from '../../../lib/bundler/bundle-modules.js';

describe('bundleModules', ({ it }) => {
    it('crawls imports and re-exports in depth-first order without rewriting imports', async () => {
        const fileSystem = makeFileSystem({
            '/app/index.js': '// entry\nimport "./a.js";\nexport * from "./b.js";',
            '/app/a.js': 'export { value } from "./shared.js";',
            '/app/b.js': 'export default 2;',
            '/app/shared.js': 'export const value = 1;',
        });
        const bundle = await bundleModules(makeArgs({ fileSystem }));

        assertEqual('./index.js', bundle.entry);
        assertModuleNames([ './index.js', './a.js', './shared.js', './b.js' ], bundle.modules);
        assertEqual('\nimport "./a.js";\nexport * from "./b.js";', bundle.modules.get('./index.js').source);
    });

    it('finds nested literal dynamic imports and reports computed imports', async () => {
        const fileSystem = makeFileSystem({
            '/app/index.js': 'async function load() { await import("./dynamic.js"); await import(name); }',
            '/app/dynamic.js': 'export default 1;',
        });
        const caught = await catchAsyncError(() => bundleModules(makeArgs({ fileSystem })));

        assert(caught, 'expected BundleError');
        assertEqual('BundleError', caught.name);
        assertEqual(1, caught.diagnostics.length);
        assertMatches('string literal', caught.diagnostics[0].message);
        assertEqual(true, caught.diagnostics[0].line > 0);
    });

    it('terminates cycles and reads a shared diamond dependency once', async () => {
        const fileSystem = makeFileSystem({
            '/app/index.js': 'import "./a.js"; import "./b.js";',
            '/app/a.js': 'import "./shared.js";',
            '/app/b.js': 'import "./shared.js";',
            '/app/shared.js': 'import "./a.js";',
        });
        const bundle = await bundleModules(makeArgs({ fileSystem }));

        assertModuleNames([ './index.js', './a.js', './shared.js', './b.js' ], bundle.modules);
        assertEqual(1, fileSystem.readCounts.get('/app/shared.js'));
    });

    it('preserves externals and collects problems from separate branches', async () => {
        const fileSystem = makeFileSystem({
            '/app/index.js': 'import "node:fs"; import "./bad.js"; import "./other.js";',
            '/app/bad.js': 'import "missing";',
            '/app/other.js': 'import "./none.js";',
        });
        const caught = await catchAsyncError(() => bundleModules(makeArgs({
            fileSystem,
            externals: [ 'node:' ],
        })));

        assert(caught, 'expected BundleError');
        assertEqual(2, caught.diagnostics.length);
        assertMatches('node:fs', fileSystem.files['/app/index.js']);
    });

    it('continues crawling sibling modules after a parse failure', async () => {
        const fileSystem = makeFileSystem({
            '/app/index.js': 'import "./broken.js"; import "./missing-import.js";',
            '/app/broken.js': 'export const = 1;',
            '/app/missing-import.js': 'import "missing";',
        });
        const caught = await catchAsyncError(() => bundleModules(makeArgs({ fileSystem })));

        assert(caught, 'expected BundleError');
        assertEqual(2, caught.diagnostics.length);
        assertMatches('Unable to parse module', caught.diagnostics[0].message);
        assertMatches('not declared external', caught.diagnostics[1].message);
    });

    it('reports an invalid entry as an entry-level diagnostic', async () => {
        const fileSystem = makeFileSystem({});
        const caught = await catchAsyncError(() => bundleModules(makeArgs({
            entryFilepath: '/app/missing.js',
            fileSystem,
        })));

        assert(caught, 'expected BundleError');
        assertEqual(null, caught.diagnostics[0].importer);
        assertMatches('not an existing file', caught.diagnostics[0].message);
    });

    it('names the importing file in the message for every rejection', async () => {
        const cases = [
            [ 'import "lodash";', 'Bare specifier "lodash" is not declared external' ],
            [ 'import "../outside.js";', 'outside the bundle base directory' ],
            [ 'import "./data.json";', 'Unsupported module type ".json"' ],
            [ 'import "./legacy.cjs";', 'CommonJS modules are not supported' ],
            [ 'import "./missing.js";', 'not an existing file' ],
            [ 'import "./Casing.js";', 'casing differs' ],
            [ 'await import(name);', 'string literal specifier' ],
        ];

        for (const [ importStatement, message ] of cases) {
            const fileSystem = makeFileSystem({
                '/app/index.js': 'import "./importer.js";',
                '/app/importer.js': `\n${ importStatement }`,
                '/app/Casing.js': 'export default 1;',
                '/outside.js': 'export default 1;',
            });
            fileSystem.realpath = async (filepath) => filepath.replace('/app/Casing.js', '/app/casing.js');

            // eslint-disable-next-line no-await-in-loop
            const caught = await catchAsyncError(() => bundleModules(makeArgs({ fileSystem, externals: [ 'node:' ] })));

            assert(caught, `expected BundleError for ${ importStatement }`);
            assertEqual('BundleError', caught.name);
            assertMatches(message, caught.message);
            assertMatches('- ./importer.js:2:', caught.message);
        }
    });
});

function makeArgs(overrides) {
    return {
        entryFilepath: '/app/index.js',
        ...overrides,
    };
}

function makeFileSystem(files) {
    const readCounts = new Map();

    return {
        files,
        readCounts,
        async readFile(filepath) {
            readCounts.set(filepath, (readCounts.get(filepath) ?? 0) + 1);
            return files[filepath];
        },
        async realpath(filepath) {
            return filepath;
        },
        async isFile(filepath) {
            return Object.hasOwn(files, filepath);
        },
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }

    return null;
}

function assertModuleNames(expected, modules) {
    const actual = [ ...modules.keys() ];

    assertEqual(expected.length, actual.length);

    for (const [ index, name ] of expected.entries()) {
        assertEqual(name, actual[index]);
    }
}
