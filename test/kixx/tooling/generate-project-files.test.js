import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from 'kixx-assert';

import {
    readInstallation,
    renderProjectFiles,
    writeProjectFiles,
} from '../../../kixx/tooling/mod.js';


const FILE_NAMES = [
    'node-registry.generated.js',
    'cloudflare-registry.generated.js',
    'cloudflare-durable-objects.generated.js',
    'routes.generated.js',
    'example.env.secrets',
];

const CORE_MANIFEST = {
    name: 'kixx',
    version: '7.0.0-alpha.0',
    description: 'Kixx core.',
    lifecycle: [ './hyperview/plugin.js' ],
    adapters: {
        node: {
            loggerWriter: './adapters/node/logger-writer/lib/logger-writer.js',
            serverRequest: './adapters/node/server-request/lib/server-request.js',
        },
        cloudflare: {
            loggerWriter: './adapters/cloudflare/logger-writer/lib/logger-writer.js',
            serverRequest: './adapters/cloudflare/server-request/lib/server-request.js',
        },
    },
};

const VISITS_MANIFEST = {
    name: 'visits',
    version: '7.0.0',
    core: '7.0.0',
    description: 'Counts visits.',
    lifecycle: [ './plugin.js' ],
    secrets: [ { name: 'VISITS_SIGNING_SECRET', description: 'Signs visit tokens.' } ],
    routes: [ { module: './routes.js', mount: '/visits', name: 'visits' } ],
};

const ADMIN_MANIFEST = {
    name: 'admin',
    version: '7.0.0',
    core: '7.0.0',
    description: 'The admin plugin.',
    lifecycle: [ './plugin.js' ],
};

const APP_MANIFEST = {
    secrets: [ { name: 'SUPPORT_TOKEN', required: false, description: 'Lets support staff sign in.' } ],
};


// An in-memory ProjectFileSystemInterface. `files` maps a project-relative
// path to its text; a directory exists when a file lies under it. Every call
// is recorded in `calls`.
function createFileSystem(files) {
    const store = new Map(Object.entries(files));
    const calls = [];

    return {
        store,
        calls,

        async readTextFile(path) {
            calls.push(`read ${ path }`);
            return store.has(path) ? store.get(path) : null;
        },

        async listDirectories(path) {
            calls.push(`list ${ path }`);

            const names = new Set();

            for (const file of store.keys()) {
                const rest = file.startsWith(`${ path }/`) ? file.slice(path.length + 1).split('/') : [];

                // A single segment is a plain file, not a directory.
                if (rest.length > 1) {
                    names.add(rest[0]);
                }
            }

            return Array.from(names).sort();
        },

        async writeTextFile(path, text) {
            calls.push(`write ${ path }`);
            store.set(path, text);
        },
    };
}

function createProject(overrides) {
    return createFileSystem(Object.assign({
        'kixx/plugin.json': JSON.stringify(CORE_MANIFEST),
        'plugins/visits/plugin.json': JSON.stringify(VISITS_MANIFEST),
        'plugins/admin/plugin.json': JSON.stringify(ADMIN_MANIFEST),
        'app/app.json': JSON.stringify(APP_MANIFEST),
    }, overrides));
}

function withoutFiles(fileSystem, paths) {
    for (const path of paths) {
        fileSystem.store.delete(path);
    }

    return fileSystem;
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}

function names(installation) {
    return installation.entries.map((entry) => entry.name).join(',');
}

function writes(fileSystem) {
    return fileSystem.calls.filter((call) => call.startsWith('write '));
}


describe('generate project files', ({ describe }) => {

    describe('readInstallation', ({ it }) => {
        it('reads core, each plugin under plugins/, and the app manifest', async () => {
            const fileSystem = createProject();
            const installation = await readInstallation({ fileSystem });

            assertEqual('kixx,admin,visits', names(installation));
            assertEqual(
                'visits:VISITS_SIGNING_SECRET,app:SUPPORT_TOKEN',
                installation.secrets.map((secret) => `${ secret.owner }:${ secret.name }`).join(','),
            );
            assert(Object.isFrozen(installation));
        });

        it('reads core first, then the plugins by name, then the app', async () => {
            const fileSystem = createProject();

            await readInstallation({ fileSystem });

            assertEqual(
                [
                    'read kixx/plugin.json',
                    'list plugins',
                    'read plugins/admin/plugin.json',
                    'read plugins/visits/plugin.json',
                    'read app/app.json',
                ].join('\n'),
                fileSystem.calls.join('\n'),
            );
        });

        it('reads core from the coreDirectory option', async () => {
            const fileSystem = withoutFiles(createProject({
                '../../../kixx/plugin.json': JSON.stringify(CORE_MANIFEST),
            }), [ 'kixx/plugin.json' ]);

            const installation = await readInstallation({ fileSystem, coreDirectory: '../../../kixx' });

            assertEqual('kixx,admin,visits', names(installation));
            assertEqual('read ../../../kixx/plugin.json', fileSystem.calls[0]);
        });

        it('skips a plugin directory without a manifest, and a plain file', async () => {
            const fileSystem = createProject({
                'plugins/studio/README.md': '# Studio',
                'plugins/README.md': '# Plugins',
            });

            const installation = await readInstallation({ fileSystem });

            assertEqual('kixx,admin,visits', names(installation));
            assert(fileSystem.calls.includes('read plugins/studio/plugin.json'));
        });

        it('resolves a project with no plugins directory', async () => {
            const fileSystem = createFileSystem({ 'kixx/plugin.json': JSON.stringify(CORE_MANIFEST) });
            const installation = await readInstallation({ fileSystem });

            assertEqual('kixx', names(installation));
        });

        it('treats a missing app manifest as no declarations', async () => {
            const fileSystem = withoutFiles(createProject(), [ 'app/app.json' ]);
            const installation = await readInstallation({ fileSystem });

            assertEqual('VISITS_SIGNING_SECRET', installation.secrets.map((secret) => secret.name).join(','));
        });

        it('fails with an OperationalError naming the path when core\'s manifest is missing', async () => {
            const fileSystem = withoutFiles(createProject(), [ 'kixx/plugin.json' ]);
            const caught = await catchRejection(readInstallation({ fileSystem }));

            assert(caught, 'expected a rejection');
            assertEqual('OperationalError', caught.name);
            assertEqual('Missing core manifest: kixx/plugin.json', caught.message);
        });

        it('names the coreDirectory path when core\'s manifest is missing there', async () => {
            const fileSystem = createProject();
            const caught = await catchRejection(readInstallation({ fileSystem, coreDirectory: '../core' }));

            assertEqual('Missing core manifest: ../core/plugin.json', caught.message);
        });

        it('fails with an OperationalError naming the file for a manifest that is not valid JSON', async () => {
            const cases = [ 'kixx/plugin.json', 'plugins/visits/plugin.json', 'app/app.json' ];

            for (const file of cases) {
                const fileSystem = createProject({ [file]: '{ "name": ' });
                const caught = await catchRejection(readInstallation({ fileSystem }));

                assert(caught, `expected a rejection for ${ file }`);
                assertEqual('OperationalError', caught.name);
                assertMatches(`Invalid JSON in ${ file }: `, caught.message);
                assertEqual('SyntaxError', caught.cause.name);
            }
        });

        it('throws an invalid manifest\'s own ValidationError, which names its file', async () => {
            const cases = [
                [ 'kixx/plugin.json', Object.assign({}, CORE_MANIFEST, { version: 'seven' }), 'Invalid plugin manifest kixx/plugin.json: ' ],
                [ 'plugins/visits/plugin.json', Object.assign({}, VISITS_MANIFEST, { migrations: [] }), 'Invalid plugin manifest plugins/visits/plugin.json: ' ],
                [ 'app/app.json', { config: {} }, 'Invalid app manifest app/app.json: ' ],
            ];

            for (const [ file, manifest, message ] of cases) {
                const fileSystem = createProject({ [file]: JSON.stringify(manifest) });
                const caught = await catchRejection(readInstallation({ fileSystem }));

                assert(caught, `expected a rejection for ${ file }`);
                assertEqual('ValidationError', caught.name);
                assertMatches(message, caught.message);
            }
        });

        it('throws the first invalid manifest\'s error and reads no further', async () => {
            const fileSystem = createProject({
                'plugins/admin/plugin.json': JSON.stringify(Object.assign({}, ADMIN_MANIFEST, { version: 'one' })),
                'plugins/visits/plugin.json': JSON.stringify(Object.assign({}, VISITS_MANIFEST, { version: 'two' })),
            });

            const caught = await catchRejection(readInstallation({ fileSystem }));

            assertMatches('Invalid plugin manifest plugins/admin/plugin.json: ', caught.message);
            assertEqual(1, caught.errors.length);
            assert(!fileSystem.calls.includes('read plugins/visits/plugin.json'));
        });

        it('rejects a plugin whose name is not its directory name', async () => {
            const fileSystem = createProject({
                'plugins/visitors/plugin.json': JSON.stringify(VISITS_MANIFEST),
            });

            const caught = await catchRejection(readInstallation({ fileSystem }));

            assertEqual('ValidationError', caught.name);
            assertMatches('Invalid plugin manifest plugins/visitors/plugin.json: ', caught.message);
            assertEqual('name', caught.errors[0].source);
        });

        it('reports a problem between manifests as one installation error', async () => {
            const fileSystem = createProject({
                'plugins/visits/plugin.json': JSON.stringify(Object.assign({}, VISITS_MANIFEST, { dependencies: [ 'studio' ] })),
            });

            const caught = await catchRejection(readInstallation({ fileSystem }));

            assertEqual('ValidationError', caught.name);
            assertEqual(
                'Invalid plugin installation: plugin "visits" depends on "studio", which is not installed',
                caught.message,
            );
        });

        it('rejects a file system that does not implement the port, and an unsafe coreDirectory', async () => {
            const missing = await catchRejection(readInstallation({}));

            assertEqual('AssertionError', missing.name);
            assertMatches('options.fileSystem must implement ProjectFileSystemInterface', missing.message);

            const fileSystem = createProject();
            const unsafe = await catchRejection(readInstallation({ fileSystem, coreDirectory: '/kixx' }));

            assertEqual('AssertionError', unsafe.name);
            assertEqual(0, fileSystem.calls.length);
        });
    });

    describe('renderProjectFiles', ({ it }) => {
        it('renders the five files and writes nothing', async () => {
            const fileSystem = createProject();
            const files = await renderProjectFiles({ fileSystem });

            assertEqual(FILE_NAMES.join(','), Array.from(files.keys()).join(','));
            assert(files.get('node-registry.generated.js').includes('import * as visitsPlugin from "./plugins/visits/plugin.js";'));
            assert(files.get('example.env.secrets').includes('\nVISITS_SIGNING_SECRET=replace-me\n'));
            assertEqual(0, writes(fileSystem).length);
        });

        it('passes coreDirectory to the renderers', async () => {
            const fileSystem = createProject({ '../../../kixx/plugin.json': JSON.stringify(CORE_MANIFEST) });
            const files = await renderProjectFiles({ fileSystem, coreDirectory: '../../../kixx' });

            assert(files.get('routes.generated.js').includes(
                'import { mountRoutes } from "../../../kixx/http-router/mount-routes.js";',
            ));
        });
    });

    describe('writeProjectFiles', ({ it }) => {
        it('writes all five files into an empty project and resolves their names', async () => {
            const fileSystem = createProject();
            const written = await writeProjectFiles({ fileSystem });
            const rendered = await renderProjectFiles({ fileSystem });

            assertEqual(FILE_NAMES.join(','), written.join(','));
            assertEqual(FILE_NAMES.map((name) => `write ${ name }`).join(','), writes(fileSystem).join(','));

            for (const name of FILE_NAMES) {
                assertEqual(rendered.get(name), fileSystem.store.get(name), name);
            }
        });

        it('replaces every file, whatever is there', async () => {
            const fileSystem = createProject({
                'routes.generated.js': 'stale',
                'example.env.secrets': 'STALE=1\n',
            });

            const rendered = await renderProjectFiles({ fileSystem });

            await writeProjectFiles({ fileSystem });

            assertEqual(5, writes(fileSystem).length);
            assertEqual(rendered.get('routes.generated.js'), fileSystem.store.get('routes.generated.js'));
            assertEqual(rendered.get('example.env.secrets'), fileSystem.store.get('example.env.secrets'));
        });

        it('rejects and writes nothing when a manifest is invalid', async () => {
            const fileSystem = createProject({
                'plugins/visits/plugin.json': JSON.stringify(Object.assign({}, VISITS_MANIFEST, { version: 'two' })),
            });

            const caught = await catchRejection(writeProjectFiles({ fileSystem }));

            assertEqual('ValidationError', caught.name);
            assertEqual(0, writes(fileSystem).length);
            assert(!fileSystem.store.has('node-registry.generated.js'));
        });

        it('rejects and writes nothing when the manifests do not fit together', async () => {
            const fileSystem = createProject({
                'app/app.json': JSON.stringify({
                    secrets: [ { name: 'VISITS_SIGNING_SECRET', description: 'Declared twice.' } ],
                }),
            });

            const caught = await catchRejection(writeProjectFiles({ fileSystem }));

            assertEqual('ValidationError', caught.name);
            assertEqual(0, writes(fileSystem).length);
        });

        it('rejects a file system that cannot write before reading anything', async () => {
            const fileSystem = createProject();

            delete fileSystem.writeTextFile;

            const caught = await catchRejection(writeProjectFiles({ fileSystem }));

            assertEqual('AssertionError', caught.name);
            assertEqual(0, fileSystem.calls.length);
        });
    });
});
