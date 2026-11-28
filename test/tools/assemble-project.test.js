import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches } from 'kixx-assert';

import {
    MARKER_FILE_NAME,
    assembleProject,
    readImportClosure,
} from '../../tools/lib/assemble-project.js';


const REPOSITORY_DIRECTORY = fileURLToPath(new URL('../../', import.meta.url));
const CORE_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'kixx');
const SKELETON_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'devkit', 'templates', 'project');

const GENERATED_FILE_NAMES = [
    'cloudflare-durable-objects.generated.js',
    'cloudflare-registry.generated.js',
    'example.env.secrets',
    'node-registry.generated.js',
    'routes.generated.js',
];

// A file in this repository that imports files outside core, and core.
const CLOSURE_ENTRY = path.join(REPOSITORY_DIRECTORY, 'test-app', 'probe', 'probe-suites.js');


// Every file under a directory, at any depth, as sorted POSIX paths
// relative to it.
function listFiles(directory) {
    return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
        .sort();
}

function readBytes(directory, name) {
    return fs.readFileSync(path.join(directory, ...name.split('/')));
}

function isSameFile(directoryA, nameA, directoryB, nameB) {
    return readBytes(directoryA, nameA).equals(readBytes(directoryB, nameB));
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

// Assembling copies about 250 files, which a busy CI runner doesn't always
// do inside the default second. Every block here gets this much.
const TIMEOUT = { timeout: 5000 };


describe('assembleProject', ({ before, after, describe }) => {
    let temporaryDirectory;

    before(async () => {
        temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-assemble-project-'));
    });

    after(async () => {
        await fsp.rm(temporaryDirectory, { recursive: true, force: true });
    });

    describe('into a directory that doesn\'t exist', ({ before, it }) => {
        let targetDirectory;
        let written;

        before(async () => {
            targetDirectory = path.join(temporaryDirectory, 'new', 'project');
            written = await assembleProject({ targetDirectory });
        });

        it('resolves every file it wrote, and nothing else is there', () => {
            assertEqual(listFiles(targetDirectory).join('\n'), written.join('\n'));
        });

        it('writes every skeleton file byte for byte', () => {
            const names = listFiles(SKELETON_DIRECTORY);

            assert(names.length > 0);

            for (const name of names) {
                // The one rename: the skeleton keeps its .gitignore as `gitignore`.
                const targetName = name === 'gitignore' ? '.gitignore' : name;

                assert(written.includes(targetName), `${ targetName } was not written`);
                assert(isSameFile(SKELETON_DIRECTORY, name, targetDirectory, targetName), `${ targetName } differs from the skeleton`);
            }
        });

        it('writes .gitignore and no file named gitignore', () => {
            assert(written.includes('.gitignore'));
            assertFalsy(written.includes('gitignore'));
        });

        it('writes core at kixx/ byte for byte', () => {
            const names = listFiles(CORE_DIRECTORY);

            assertEqual(
                names.map((name) => `kixx/${ name }`).join('\n'),
                written.filter((name) => name.startsWith('kixx/')).join('\n'),
            );

            for (const name of names) {
                assert(isSameFile(CORE_DIRECTORY, name, targetDirectory, `kixx/${ name }`), `kixx/${ name } differs from core`);
            }
        });

        it('writes the five generated files', () => {
            for (const name of GENERATED_FILE_NAMES) {
                assert(written.includes(name), `${ name } was not written`);
            }

            assertEqual(
                GENERATED_FILE_NAMES.filter((name) => name.endsWith('.generated.js')).join(','),
                written.filter((name) => name.endsWith('.generated.js')).join(','),
            );
        });

        it('generates registries that import core from ./kixx/', () => {
            for (const name of [ 'node-registry.generated.js', 'cloudflare-registry.generated.js' ]) {
                const source = readBytes(targetDirectory, name).toString('utf8');

                assertMatches(/from "\.\/kixx\//, source);
                assertFalsy(source.includes('../'), `${ name } imports from outside the project`);
            }
        });

        it('mounts the Publishing API in routes.generated.js', () => {
            const source = readBytes(targetDirectory, 'routes.generated.js').toString('utf8');

            assertMatches('./kixx/publishing-api/routes.js', source);
            assertMatches('/publishing-api/v1', source);
        });

        it('writes the marker file', () => {
            assert(written.includes(MARKER_FILE_NAME));
        });

        it('writes only the skeleton, core, the generated files, and the marker', () => {
            const expected = listFiles(SKELETON_DIRECTORY).length
                + listFiles(CORE_DIRECTORY).length
                + GENERATED_FILE_NAMES.length
                + 1;

            assertEqual(expected, written.length);
        });
    });

    describe('into a directory it built before, with overlays and a closure entry', ({ before, it }) => {
        let targetDirectory;
        let overlayDirectory;
        let firstBuild;
        let written;

        before(async () => {
            // The first build goes into a directory that exists and is empty.
            targetDirectory = path.join(temporaryDirectory, 'rebuilt');
            await fsp.mkdir(targetDirectory);
            firstBuild = await assembleProject({ targetDirectory });

            // Left by a developer, or by an earlier build with other options.
            await fsp.writeFile(path.join(targetDirectory, 'left-over.txt'), 'left over\n');

            overlayDirectory = path.join(temporaryDirectory, 'overlay');
            await fsp.mkdir(path.join(overlayDirectory, 'extras', 'nested'), { recursive: true });
            await fsp.writeFile(path.join(overlayDirectory, 'extras', 'notes.txt'), 'made up\n');
            await fsp.writeFile(path.join(overlayDirectory, 'extras', 'nested', 'module.js'), 'export default \'made up\';\n');
            await fsp.writeFile(path.join(overlayDirectory, 'first-config.jsonc'), '{ "name": "first" }\n');
            await fsp.writeFile(path.join(overlayDirectory, 'second-config.jsonc'), '{ "name": "second" }\n');

            written = await assembleProject({
                targetDirectory,
                overlays: [
                    { from: path.join(overlayDirectory, 'extras'), to: 'extras/made-up' },
                    { from: path.join(overlayDirectory, 'first-config.jsonc'), to: 'cloudflare-config.jsonc' },
                    { from: path.join(overlayDirectory, 'second-config.jsonc'), to: 'cloudflare-config.jsonc' },
                ],
                closureEntries: [ CLOSURE_ENTRY ],
            });
        });

        it('builds into an empty directory first', () => {
            assert(firstBuild.includes('node-server.js'));
            assert(firstBuild.includes(MARKER_FILE_NAME));
            assertFalsy(firstBuild.some((name) => name.startsWith('extras/')));
        });

        it('replaces what was there', () => {
            assertFalsy(fs.existsSync(path.join(targetDirectory, 'left-over.txt')));
            assertEqual(listFiles(targetDirectory).join('\n'), written.join('\n'));
            assert(written.includes(MARKER_FILE_NAME));
        });

        it('copies an overlay directory to its `to` path', () => {
            assert(isSameFile(overlayDirectory, 'extras/notes.txt', targetDirectory, 'extras/made-up/notes.txt'));
            assert(isSameFile(overlayDirectory, 'extras/nested/module.js', targetDirectory, 'extras/made-up/nested/module.js'));
        });

        it('replaces a skeleton file with an overlay file, and an earlier overlay with a later one', () => {
            assertEqual('{ "name": "second" }\n', readBytes(targetDirectory, 'cloudflare-config.jsonc').toString('utf8'));
        });

        it('leaves every other skeleton file as the skeleton has it', () => {
            for (const name of listFiles(SKELETON_DIRECTORY)) {
                if (name !== 'cloudflare-config.jsonc' && name !== 'gitignore') {
                    assert(isSameFile(SKELETON_DIRECTORY, name, targetDirectory, name), `${ name } differs from the skeleton`);
                }
            }
        });

        it('copies a closure entry and what it imports to their repository paths', () => {
            assert(isSameFile(REPOSITORY_DIRECTORY, 'test-app/probe/probe-suites.js', targetDirectory, 'test-app/probe/probe-suites.js'));

            // One of the suites the probe registers.
            const suite = 'test/kixx/key-value-store/key-value-store-conformance.js';

            assert(isSameFile(REPOSITORY_DIRECTORY, suite, targetDirectory, suite));
        });

        it('copies core once, at kixx/', () => {
            assertFalsy(written.some((name) => name.startsWith('kixx/kixx/')));
            assertEqual(listFiles(CORE_DIRECTORY).length, written.filter((name) => name.startsWith('kixx/')).length);
        });
    });

    describe('after a build that failed part way', ({ before, it }) => {
        let targetDirectory;
        let error;
        let leftBehind;
        let written;

        before(async () => {
            targetDirectory = path.join(temporaryDirectory, 'failed');

            // The closure is read after the skeleton and core are copied.
            error = await catchAsyncError(() => {
                return assembleProject({
                    targetDirectory,
                    closureEntries: [ path.join(temporaryDirectory, 'no-such-entry.js') ],
                });
            });

            leftBehind = listFiles(targetDirectory);
            written = await assembleProject({ targetDirectory });
        });

        it('leaves the marker beside what it copied', () => {
            assertEqual('OperationalError', error.name);
            assert(leftBehind.includes(MARKER_FILE_NAME));
            assert(leftBehind.includes('node-server.js'));
            assertFalsy(leftBehind.includes('routes.generated.js'));
        });

        it('is replaced by the next build', () => {
            assertEqual(listFiles(targetDirectory).join('\n'), written.join('\n'));
            assert(written.includes('routes.generated.js'));
        });
    });

    describe('into a directory it didn\'t build', ({ it }) => {
        it('refuses, and leaves the directory as it was', async () => {
            const targetDirectory = path.join(temporaryDirectory, 'someone-elses');
            await fsp.mkdir(targetDirectory);
            await fsp.writeFile(path.join(targetDirectory, 'keep.txt'), 'keep me\n');

            const error = await catchAsyncError(() => assembleProject({ targetDirectory }));

            assert(error, 'expected the build to be refused');
            assertEqual('OperationalError', error.name);
            assertMatches(targetDirectory, error.message);
            assertMatches(MARKER_FILE_NAME, error.message);
            assertEqual('keep.txt', listFiles(targetDirectory).join(','));
            assertEqual('keep me\n', readBytes(targetDirectory, 'keep.txt').toString('utf8'));
        });

        it('refuses a target that is a file', async () => {
            const targetDirectory = path.join(temporaryDirectory, 'a-file');
            await fsp.writeFile(targetDirectory, 'a file\n');

            const error = await catchAsyncError(() => assembleProject({ targetDirectory }));

            assertEqual('OperationalError', error.name);
            assertEqual('a file\n', fs.readFileSync(targetDirectory, 'utf8'));
        });

        it('refuses a relative target', async () => {
            const error = await catchAsyncError(() => assembleProject({ targetDirectory: 'relative/project' }));

            assertEqual('OperationalError', error.name);
            assertMatches('absolute path', error.message);
        });
    });

    // Called with a temporary directory as its root, so no broken file is
    // ever written into the repository.
    describe('readImportClosure', ({ before, it }) => {
        let rootDirectory;
        let coreDirectory;

        async function writeModule(name, source) {
            const filepath = path.join(rootDirectory, ...name.split('/'));

            await fsp.mkdir(path.dirname(filepath), { recursive: true });
            await fsp.writeFile(filepath, source);

            return filepath;
        }

        before(async () => {
            rootDirectory = path.join(temporaryDirectory, 'closure-root');
            coreDirectory = path.join(rootDirectory, 'kixx');

            await writeModule('kixx/core-module.js', 'import \'./never-read.js\';\n');
            await writeModule('suites/shared.js', 'import \'../kixx/core-module.js\';\n');
            await writeModule('probe/entry.js', 'import \'../suites/shared.js\';\nimport \'node:path\';\nimport \'a-package\';\n');
            await writeModule('probe/broken.js', 'import \'./missing.js\';\n');
            await writeModule('probe/escapes.js', 'import \'../../outside.js\';\n');
        });

        it('returns the entry file and what it reaches outside core, and never reads core', () => {
            const files = readImportClosure({
                entryFiles: [ path.join(rootDirectory, 'probe', 'entry.js') ],
                rootDirectory,
                coreDirectory,
            });

            // kixx/core-module.js imports a file that doesn't exist. Core
            // is not followed, so that is never noticed here.
            assertEqual(
                'probe/entry.js,suites/shared.js',
                files.map((filepath) => path.relative(rootDirectory, filepath).split(path.sep).join('/')).join(','),
            );
        });

        it('fails, naming the importer, when an import resolves to nothing', () => {
            const importer = path.join(rootDirectory, 'probe', 'broken.js');
            const error = catchError(() => readImportClosure({ entryFiles: [ importer ], rootDirectory, coreDirectory }));

            assert(error, 'expected an error to be thrown');
            assertEqual('OperationalError', error.name);
            assertMatches(importer, error.message);
            assertMatches('./missing.js', error.message);
        });

        it('fails, naming the importer, when an import leaves the root', () => {
            const importer = path.join(rootDirectory, 'probe', 'escapes.js');
            const error = catchError(() => readImportClosure({ entryFiles: [ importer ], rootDirectory, coreDirectory }));

            assert(error, 'expected an error to be thrown');
            assertEqual('OperationalError', error.name);
            assertMatches(importer, error.message);
            assertMatches('../../outside.js', error.message);
        });

        it('fails when an entry file doesn\'t exist', () => {
            const entryFile = path.join(rootDirectory, 'probe', 'no-such-entry.js');
            const error = catchError(() => readImportClosure({ entryFiles: [ entryFile ], rootDirectory, coreDirectory }));

            assertEqual('OperationalError', error.name);
            assertMatches(entryFile, error.message);
        });
    });
}, TIMEOUT);
