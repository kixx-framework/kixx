import fsp from 'node:fs/promises';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import UsageError from '../../../lib/usage-error.js';
import { getExitCodeForError } from '../../../lib/exit-codes.js';
import {
    OLDEST_SUPPORTED_PROJECT_VERSION,
    UnsupportedProjectVersionError,
    checkProjectVersion,
    readProjectVersion,
} from '../../../lib/project/project-version.js';
import { withTemporaryDirectory, writeProjectMarker } from '../../helpers/temporary-project.js';


const CLI_VERSION = '7.0.0-alpha.0';

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}

function check(projectVersion, cliVersion = CLI_VERSION) {
    return checkProjectVersion({ projectVersion, cliVersion });
}


describe('project-version', ({ describe }) => {

    describe('checkProjectVersion()', ({ it }) => {
        it('supports 7.0.0 as the oldest project version', () => {
            assertEqual('7.0.0', OLDEST_SUPPORTED_PROJECT_VERSION);
        });

        it('passes the oldest supported version, with or without a prerelease tag', () => {
            assertEqual(false, check('7.0.0-alpha.0').isNewerThanCli);
            assertEqual(false, check('7.0.0', '7.0.0').isNewerThanCli);
            assertEqual(false, check('7.0.0-rc.1', '7.0.0').isNewerThanCli);
        });

        it('passes a same-major project older than or equal to the CLI', () => {
            assertEqual(false, check('7.1.0', '7.2.0').isNewerThanCli);
            assertEqual(false, check('7.2.3', '7.2.3').isNewerThanCli);
            assertEqual(false, check('7.9.0', '7.10.0').isNewerThanCli);
        });

        it('passes a same-major project newer than the CLI, and says so', () => {
            assertEqual(true, check('7.0.1').isNewerThanCli);
            assertEqual(true, check('7.3.0', '7.2.9').isNewerThanCli);
            assertEqual(true, check('7.10.0', '7.9.0').isNewerThanCli);
        });

        it('orders prerelease tags of the same version by semantic versioning precedence', () => {
            assertEqual(true, check('7.0.0', '7.0.0-alpha.0').isNewerThanCli);
            assertEqual(true, check('7.0.0-alpha.1', '7.0.0-alpha.0').isNewerThanCli);
            assertEqual(true, check('7.0.0-alpha.10', '7.0.0-alpha.9').isNewerThanCli);
            assertEqual(true, check('7.0.0-beta', '7.0.0-alpha.1').isNewerThanCli);
            assertEqual(true, check('7.0.0-alpha.beta', '7.0.0-alpha.1').isNewerThanCli);
            assertEqual(true, check('7.0.0-alpha.0', '7.0.0-alpha').isNewerThanCli);

            assertEqual(false, check('7.0.0-alpha.0', '7.0.0').isNewerThanCli);
            assertEqual(false, check('7.0.0-alpha.0', '7.0.0-alpha.0').isNewerThanCli);
            assertEqual(false, check('7.0.0-rc.1', '7.0.1-alpha.0').isNewerThanCli);
        });

        it('refuses an older major version, naming both versions and the action', () => {
            const error = catchError(() => check('6.9.0'));

            assert(error instanceof UnsupportedProjectVersionError, 'an UnsupportedProjectVersionError');
            assert(error instanceof UsageError, 'a UsageError');
            assertEqual('UnsupportedProjectVersion', error.code);
            assertEqual(3, getExitCodeForError(error));
            assertMatches('Kixx 6.9.0', error.message);
            assertMatches('kixx-dev 7.0.0-alpha.0', error.message);
            assertMatches('Install kixx-dev version 6', error.message);
        });

        it('refuses a newer major version, naming both versions and the action', () => {
            const error = catchError(() => check('8.0.0'));

            assert(error instanceof UnsupportedProjectVersionError, 'an UnsupportedProjectVersionError');
            assertEqual(3, getExitCodeForError(error));
            assertMatches('Kixx 8.0.0', error.message);
            assertMatches('kixx-dev 7.0.0-alpha.0', error.message);
            assertMatches('Upgrade kixx-dev to version 8', error.message);
        });

        it('refuses a same-major project older than the oldest supported version', () => {
            const error = catchError(() => checkProjectVersion({
                projectVersion: '7.1.9',
                cliVersion: '7.4.0',
                oldestSupportedVersion: '7.2.0',
            }));

            assert(error instanceof UnsupportedProjectVersionError, 'an UnsupportedProjectVersionError');
            assertMatches('Kixx 7.1.9', error.message);
            assertMatches('supports 7.2.0 and later 7.x versions', error.message);
            assertMatches('Upgrade the project\'s Kixx', error.message);
        });
    });

    describe('readProjectVersion()', ({ it }) => {
        it('reads the version from kixx/plugin.json', async () => {
            await withTemporaryDirectory(async (directory) => {
                await writeProjectMarker(directory, { version: '7.0.0-alpha.0' });

                assertEqual('7.0.0-alpha.0', await readProjectVersion(directory));
            });
        });

        it('rejects a manifest that is not JSON, naming the file', async () => {
            await withTemporaryDirectory(async (directory) => {
                await writeProjectMarker(directory, { manifestText: '{ broken' });

                const error = await catchRejection(readProjectVersion(directory));

                assert(error instanceof UnsupportedProjectVersionError, 'an UnsupportedProjectVersionError');
                assertEqual(3, getExitCodeForError(error));
                assertMatches(path.join(directory, 'kixx', 'plugin.json'), error.message);
                assertMatches('not valid JSON', error.message);
            });
        });

        it('rejects a manifest with no valid version', async () => {
            const manifests = [
                '{}',
                '{"version":7}',
                '{"version":""}',
                '{"version":"7.0"}',
                '{"version":"v7.0.0"}',
                '[]',
                'null',
            ];

            await withTemporaryDirectory(async (directory) => {
                for (const manifestText of manifests) {
                    await writeProjectMarker(directory, { manifestText });

                    const error = await catchRejection(readProjectVersion(directory));

                    assert(error instanceof UnsupportedProjectVersionError, `rejected ${ manifestText }`);
                    assertMatches('has no "version"', error.message);
                }
            });
        });

        it('rejects a manifest that cannot be read', async () => {
            await withTemporaryDirectory(async (directory) => {
                await fsp.mkdir(path.join(directory, 'kixx'));

                const error = await catchRejection(readProjectVersion(directory));

                assert(error instanceof UnsupportedProjectVersionError, 'an UnsupportedProjectVersionError');
                assertMatches(path.join(directory, 'kixx', 'plugin.json'), error.message);
            });
        });
    });
});
