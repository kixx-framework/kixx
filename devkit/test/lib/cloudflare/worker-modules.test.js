import { describe } from 'kixx-test';
import { assert, assertEqual, assertNotEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { hashWorkerModules, packageWorkerModules, toWorkerModules } from '../../../lib/cloudflare/worker-modules.js';


describe('cloudflare/worker-modules', ({ it }) => {
    it('returns mainModule as the entry key without ./', () => {
        const bundle = makeBundle('./cloudflare-server.js', [
            [ './cloudflare-server.js', 'export default 1;' ],
        ]);

        const { mainModule } = toWorkerModules(bundle);

        assertEqual('cloudflare-server.js', mainModule);
    });

    it('strips ./ from every module name and keeps the relative path', () => {
        const bundle = makeBundle('./cloudflare-server.js', [
            [ './cloudflare-server.js', 'export default 1;' ],
            [ './kixx/logger/logger.js', 'export default 2;' ],
        ]);

        const { modules } = toWorkerModules(bundle);
        const names = modules.map((mod) => mod.name);

        assertEqual('cloudflare-server.js', names[0]);
        assertEqual('kixx/logger/logger.js', names[1]);
    });

    it('returns the entry as the first array element', () => {
        const bundle = makeBundle('./cloudflare-server.js', [
            [ './cloudflare-server.js', 'export default 1;' ],
            [ './lib/helper.js', 'export default 2;' ],
        ]);

        const { modules } = toWorkerModules(bundle);

        assertEqual('cloudflare-server.js', modules[0].name);
    });

    it('returns module sources verbatim', () => {
        const source = 'export default function () {\n    return 1;\n}\n';
        const bundle = makeBundle('./cloudflare-server.js', [
            [ './cloudflare-server.js', source ],
        ]);

        const { modules } = toWorkerModules(bundle);

        assertEqual(source, modules[0].content);
    });

    it('throws when a module key does not start with ./', () => {
        const bundle = makeBundle('cloudflare-server.js', [
            [ 'cloudflare-server.js', 'export default 1;' ],
        ]);

        const caught = catchError(() => toWorkerModules(bundle));

        assert(caught, 'expected an error to be thrown');
    });

    it('hashes two module arrays identically regardless of order', () => {
        const a = [
            { name: 'cloudflare-server.js', content: 'one' },
            { name: 'lib/helper.js', content: 'two' },
        ];
        const b = [
            { name: 'lib/helper.js', content: 'two' },
            { name: 'cloudflare-server.js', content: 'one' },
        ];

        assertEqual(hashWorkerModules(a), hashWorkerModules(b));
    });

    it('changes the digest when one byte of one module changes', () => {
        const a = [ { name: 'cloudflare-server.js', content: 'one' } ];
        const b = [ { name: 'cloudflare-server.js', content: 'onf' } ];

        assertNotEqual(hashWorkerModules(a), hashWorkerModules(b));
    });

    it('changes the digest when a module is renamed', () => {
        const a = [ { name: 'cloudflare-server.js', content: 'one' } ];
        const b = [ { name: 'cloudflare-worker.js', content: 'one' } ];

        assertNotEqual(hashWorkerModules(a), hashWorkerModules(b));
    });

    it('changes the digest when a module is added', () => {
        const a = [ { name: 'cloudflare-server.js', content: 'one' } ];
        const b = [
            { name: 'cloudflare-server.js', content: 'one' },
            { name: 'lib/helper.js', content: 'two' },
        ];

        assertNotEqual(hashWorkerModules(a), hashWorkerModules(b));
    });

    it('distinguishes module sets whose names and sources concatenate ambiguously', () => {
        // Without a length delimiter, "a" + "\n" + "b\nc" + "\n" equals
        // "a\nb" + "\n" + "c" + "\n". The length delimiter must keep these apart.
        const a = [ { name: 'a', content: 'b\nc' } ];
        const b = [ { name: 'a\nb', content: 'c' } ];

        assertNotEqual(hashWorkerModules(a), hashWorkerModules(b));
    });

    it('packages the graph rooted at cloudflare-server.js with Workers externals', async () => {
        const calls = [];
        const fileSystem = {};
        const bundleModules = async (args) => {
            calls.push(args);
            return makeBundle('./cloudflare-server.js', [
                [ './cloudflare-server.js', 'import "./b.js";' ],
                [ './b.js', 'export default 1;' ],
            ]);
        };

        const result = await packageWorkerModules({ projectDirectory: '/app', fileSystem, bundleModules });

        assertEqual('/app/cloudflare-server.js', calls[0].entryFilepath);
        assertEqual('node:,cloudflare:', calls[0].externals.join(','));
        assertEqual(fileSystem, calls[0].fileSystem);
        assertEqual('cloudflare-server.js', result.mainModule);
        assertEqual('cloudflare-server.js,b.js', result.modules.map((mod) => mod.name).join(','));
        assertEqual(hashWorkerModules(result.modules), result.modulesHash);
    });
});

function makeBundle(entry, entries) {
    const modules = new Map();

    for (const [ name, source ] of entries) {
        modules.set(name, { name, source });
    }

    return { entry, modules };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
