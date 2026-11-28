import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import { getExitCodeForError } from '../../../lib/exit-codes.js';
import loadProjectTooling, { REQUIRED_TOOLING_EXPORTS } from '../../../lib/project/load-project-tooling.js';
import { withTemporaryDirectory } from '../../helpers/temporary-project.js';


const TOOLING = 'kixx/tooling/mod.js';
const PROJECT_FILE_SYSTEM = 'kixx/adapters/node/tooling/lib/project-file-system.js';
const CONTENT_SOURCE = 'kixx/adapters/node/content-compiler/lib/file-system-content-source.js';

const MODULE_PATHS = [ TOOLING, PROJECT_FILE_SYSTEM, CONTENT_SOURCE ];

function noop() {}

// The three modules as a project's core exports them.
function makeModules() {
    return {
        [TOOLING]: Object.fromEntries(REQUIRED_TOOLING_EXPORTS.map((name) => [ name, noop ])),
        [PROJECT_FILE_SYSTEM]: { createProjectFileSystem: noop },
        [CONTENT_SOURCE]: { createFileSystemContentSource: noop },
    };
}

// Writes an empty file for each module path, so the loader finds them. The
// fake importer supplies what each one exports.
async function writeModuleFiles(directory, modulePaths) {
    for (const modulePath of modulePaths) {
        const filepath = path.join(directory, ...modulePath.split('/'));

        await fsp.mkdir(path.dirname(filepath), { recursive: true });
        await fsp.writeFile(filepath, '');
    }
}

function makeImporter(directory, modules) {
    const urls = [];

    const importModule = async (url) => {
        urls.push(url);

        for (const modulePath of MODULE_PATHS) {
            if (url === pathToFileURL(path.join(directory, ...modulePath.split('/'))).href) {
                return modules[modulePath];
            }
        }

        throw new Error(`unexpected import of ${ url }`);
    };

    return { importModule, urls };
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}


describe('loadProjectTooling()', ({ it }) => {

    it('imports the project\'s three core modules by file URL, and nothing else', async () => {
        await withTemporaryDirectory(async (directory) => {
            await writeModuleFiles(directory, MODULE_PATHS);

            const { importModule, urls } = makeImporter(directory, makeModules());

            await loadProjectTooling(directory, { importModule });

            assertEqual(3, urls.length);

            for (const [ index, modulePath ] of MODULE_PATHS.entries()) {
                assertMatches(/^file:\/\//, urls[index]);
                assert(urls[index].endsWith(`/${ modulePath }`), `imports ${ modulePath }`);
            }
        });
    });

    it('resolves the tooling namespace and the two factories, frozen', async () => {
        await withTemporaryDirectory(async (directory) => {
            await writeModuleFiles(directory, MODULE_PATHS);

            const modules = makeModules();
            const { importModule } = makeImporter(directory, modules);
            const loaded = await loadProjectTooling(directory, { importModule });

            assertEqual('tooling,createProjectFileSystem,createFileSystemContentSource', Object.keys(loaded).join(','));
            assertEqual(modules[TOOLING], loaded.tooling);
            assertEqual(modules[PROJECT_FILE_SYSTEM].createProjectFileSystem, loaded.createProjectFileSystem);
            assertEqual(modules[CONTENT_SOURCE].createFileSystemContentSource, loaded.createFileSystemContentSource);
            assert(Object.isFrozen(loaded), 'frozen');
        });
    });

    it('rejects with UnsupportedProjectVersion, naming the file, when a module is missing', async () => {
        for (const missing of MODULE_PATHS) {
            // eslint-disable-next-line no-await-in-loop
            await withTemporaryDirectory(async (directory) => {
                await writeModuleFiles(directory, MODULE_PATHS.filter((modulePath) => modulePath !== missing));

                const { importModule } = makeImporter(directory, makeModules());
                const error = await catchRejection(loadProjectTooling(directory, { importModule }));

                assert(error, `expected a rejection without ${ missing }`);
                assertEqual('UnsupportedProjectVersion', error.code);
                assertEqual(3, getExitCodeForError(error));
                assertMatches(missing, error.message);
                assertMatches(path.join(directory, ...missing.split('/')), error.message);
            });
        }
    });

    it('rejects with UnsupportedProjectVersion when the tooling lacks an export the devkit calls', async () => {
        await withTemporaryDirectory(async (directory) => {
            await writeModuleFiles(directory, MODULE_PATHS);

            const modules = makeModules();
            delete modules[TOOLING][REQUIRED_TOOLING_EXPORTS[0]];

            const { importModule } = makeImporter(directory, modules);
            const error = await catchRejection(loadProjectTooling(directory, { importModule }));

            assert(error, 'expected a rejection');
            assertEqual('UnsupportedProjectVersion', error.code);
            assertMatches(TOOLING, error.message);
            assertMatches(`${ REQUIRED_TOOLING_EXPORTS[0] }()`, error.message);
        });
    });

    it('rejects with UnsupportedProjectVersion when an adapter module lacks its factory', async () => {
        await withTemporaryDirectory(async (directory) => {
            await writeModuleFiles(directory, MODULE_PATHS);

            const modules = makeModules();
            modules[CONTENT_SOURCE] = {};

            const { importModule } = makeImporter(directory, modules);
            const error = await catchRejection(loadProjectTooling(directory, { importModule }));

            assert(error, 'expected a rejection');
            assertEqual('UnsupportedProjectVersion', error.code);
            assertMatches('createFileSystemContentSource()', error.message);
        });
    });

    it('lets a module that fails to load reject as it is', async () => {
        await withTemporaryDirectory(async (directory) => {
            await writeModuleFiles(directory, MODULE_PATHS);

            const failure = new SyntaxError('Unexpected token');
            const error = await catchRejection(loadProjectTooling(directory, {
                importModule: async () => {
                    throw failure;
                },
            }));

            assertEqual(failure, error);
            assertEqual(1, getExitCodeForError(error));
        });
    });

    it('imports real modules with the default importer', async () => {
        await withTemporaryDirectory(async (directory) => {
            const sources = {
                [TOOLING]: 'export function writeProjectFiles() { return \'written\'; }\n',
                [PROJECT_FILE_SYSTEM]: 'export function createProjectFileSystem() {}\n',
                [CONTENT_SOURCE]: 'export function createFileSystemContentSource() {}\n',
            };

            for (const [ modulePath, source ] of Object.entries(sources)) {
                const filepath = path.join(directory, ...modulePath.split('/'));

                await fsp.mkdir(path.dirname(filepath), { recursive: true });
                await fsp.writeFile(filepath, source);
            }

            const loaded = await loadProjectTooling(directory);

            assertEqual('written', loaded.tooling.writeProjectFiles());
        });
    });
});
