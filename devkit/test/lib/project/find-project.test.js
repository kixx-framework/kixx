import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import UsageError from '../../../lib/usage-error.js';
import { getExitCodeForError } from '../../../lib/exit-codes.js';
import { ProjectNotFoundError, findProject, requireProject } from '../../../lib/project/find-project.js';
import { withTemporaryDirectory, writeProjectMarker } from '../../helpers/temporary-project.js';


async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}


describe('find-project', ({ describe }) => {

    describe('findProject()', ({ it }) => {
        it('returns the start directory when it holds kixx/plugin.json', async () => {
            await withTemporaryDirectory(async (directory) => {
                await writeProjectMarker(directory);

                assertEqual(directory, await findProject(directory));
            });
        });

        it('walks up from a subdirectory to the project root', async () => {
            await withTemporaryDirectory(async (directory) => {
                const deep = path.join(directory, 'app', 'pages', 'blog');

                await writeProjectMarker(directory);
                await fsp.mkdir(deep, { recursive: true });

                assertEqual(directory, await findProject(deep));
            });
        });

        it('returns the nearest project when projects are nested', async () => {
            await withTemporaryDirectory(async (directory) => {
                const inner = path.join(directory, 'tmp', 'inner');

                await writeProjectMarker(directory);
                await writeProjectMarker(inner);
                await fsp.mkdir(path.join(inner, 'app'));

                assertEqual(inner, await findProject(path.join(inner, 'app')));
            });
        });

        it('resolves a relative start directory', async () => {
            await withTemporaryDirectory(async (directory) => {
                await writeProjectMarker(directory);

                const relative = path.relative(process.cwd(), directory);

                assertEqual(directory, await findProject(relative));
            });
        });

        it('returns null when no directory up to the root holds the manifest', async () => {
            await withTemporaryDirectory(async (directory) => {
                assertEqual(null, await findProject(directory));
            });
        });

        it('does not take a .kixx directory for a project', async () => {
            await withTemporaryDirectory(async (directory) => {
                await fsp.mkdir(path.join(directory, '.kixx'));

                assertEqual(null, await findProject(directory));
            });
        });

        it('does not take a directory named kixx/plugin.json for the manifest', async () => {
            await withTemporaryDirectory(async (directory) => {
                await fsp.mkdir(path.join(directory, 'kixx', 'plugin.json'), { recursive: true });

                assertEqual(null, await findProject(directory));
            });
        });
    });

    describe('requireProject()', ({ it }) => {
        it('resolves the project directory', async () => {
            await withTemporaryDirectory(async (directory) => {
                await writeProjectMarker(directory);
                await fsp.mkdir(path.join(directory, 'app'));

                assertEqual(directory, await requireProject(path.join(directory, 'app')));
            });
        });

        it('rejects with ProjectNotFoundError naming the start directory', async () => {
            await withTemporaryDirectory(async (directory) => {
                const error = await catchRejection(requireProject(directory));

                assert(error instanceof ProjectNotFoundError, 'a ProjectNotFoundError');
                assert(error instanceof UsageError, 'a UsageError');
                assertEqual('ProjectNotFound', error.code);
                assertEqual(3, getExitCodeForError(error));
                assertMatches(directory, error.message);
                assertMatches('kixx/plugin.json', error.message);
            });
        });
    });
});
