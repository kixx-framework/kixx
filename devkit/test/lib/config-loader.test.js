import fsp from 'node:fs/promises';
import path from 'node:path';
import { describe, MockTracker } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from '../../lib/vendor/kixx-assert/mod.js';
import {
    findMissingKeys,
    loadConfiguration,
} from '../../lib/config-loader.js';


describe('ConfigLoader', ({ it }) => {
    it('reports only absent dotted key paths in their given order', () => {
        const source = {
            service: {
                count: 0,
                empty: '',
                enabled: false,
                nil: null,
            },
            scalar: 'value',
        };

        const missing = findMissingKeys(source, [
            'service.nil',
            'service.enabled',
            'service.unknown',
            'scalar.child',
            'service.count',
            'service.empty',
        ]);

        assertEqual(3, missing.length);
        assertEqual('service.nil', missing[0]);
        assertEqual('service.unknown', missing[1]);
        assertEqual('scalar.child', missing[2]);
    });

    it('merges home and project layers without reading the filesystem', async () => {
        await withMockTracker(async (tracker) => {
            const homeDirectory = path.resolve('/home/tester');
            const projectDirectory = path.resolve('/work/project');
            const startDirectory = path.join(projectDirectory, 'src');
            const projectConfigDirectory = path.join(projectDirectory, '.kixx');
            const fileContents = new Map([
                [ path.join(homeDirectory, '.kixx', 'config.json'), JSON.stringify({
                    list: [ 'home' ],
                    service: {
                        host: 'home.example',
                        port: 80,
                    },
                }) ],
                [ path.join(projectDirectory, '.kixx', 'config.json'), JSON.stringify({
                    enabled: false,
                    list: [ 'project' ],
                    service: {
                        port: 443,
                    },
                }) ],
                [ path.join(homeDirectory, '.kixx', 'secrets.json'), JSON.stringify({
                    cloudflare: {
                        accountId: 'home-account',
                        apiToken: 'home-token',
                    },
                }) ],
                [ path.join(projectDirectory, '.kixx', 'secrets.json'), JSON.stringify({
                    cloudflare: {
                        accountId: 'project-account',
                    },
                }) ],
            ]);

            tracker.method(fsp, 'stat', async (filepath) => {
                return makeStats(filepath === projectConfigDirectory);
            });
            tracker.method(fsp, 'readFile', async (filepath) => {
                return fileContents.get(filepath);
            });

            const result = await loadConfiguration({ startDirectory, homeDirectory });

            assertEqual(projectDirectory, result.projectDirectory);
            assertEqual('home.example', result.config.service.host);
            assertEqual(443, result.config.service.port);
            assertEqual(false, result.config.enabled);
            assertEqual(1, result.config.list.length);
            assertEqual('project', result.config.list[0]);
            assertEqual('project-account', result.secrets.cloudflare.accountId);
            assertEqual('home-token', result.secrets.cloudflare.apiToken);
        });
    });

    it('deeply freezes merged configuration', async () => {
        await withMockTracker(async (tracker) => {
            const homeDirectory = path.resolve('/home/tester');
            const startDirectory = path.resolve('/work/project');

            tracker.method(fsp, 'stat', async () => makeStats(false));
            tracker.method(fsp, 'readFile', async (filepath) => {
                if (filepath.endsWith('config.json')) {
                    return JSON.stringify({ nested: { values: [ 'one' ] } });
                }
                return JSON.stringify({ nested: { token: 'secret' } });
            });

            const result = await loadConfiguration({ startDirectory, homeDirectory });

            assert(Object.isFrozen(result.config));
            assert(Object.isFrozen(result.config.nested));
            assert(Object.isFrozen(result.config.nested.values));
            assert(Object.isFrozen(result.secrets));
            assert(Object.isFrozen(result.secrets.nested));
        });
    });

    it('treats missing configuration files as empty layers', async () => {
        await withMockTracker(async (tracker) => {
            const homeDirectory = path.resolve('/home/tester');
            const startDirectory = path.resolve('/work/project');

            tracker.method(fsp, 'stat', async () => makeStats(false));
            tracker.method(fsp, 'readFile', async () => {
                throw makeFileSystemError('ENOENT', 'file does not exist');
            });

            const result = await loadConfiguration({ startDirectory, homeDirectory });

            assertEqual(startDirectory, result.projectDirectory);
            assertEqual(0, Object.keys(result.config).length);
            assertEqual(0, Object.keys(result.secrets).length);
            assertEqual(1, result.configFilepaths.length);
            assertEqual(1, result.secretsFilepaths.length);
        });
    });

    it('reports malformed JSON as a usage error', async () => {
        await withMockTracker(async (tracker) => {
            const homeDirectory = path.resolve('/home/tester');

            tracker.method(fsp, 'stat', async () => makeStats(false));
            tracker.method(fsp, 'readFile', async () => '{ invalid json');

            const caught = await catchAsyncError(() => {
                return loadConfiguration({
                    startDirectory: path.resolve('/work/project'),
                    homeDirectory,
                });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('UsageError', caught.name);
            assertMatches('Unable to parse JSON in', caught.message);
            assertMatches(path.join(homeDirectory, '.kixx', 'config.json'), caught.message);
        });
    });

    it('reports a JSON value that is not an object as a usage error', async () => {
        await withMockTracker(async (tracker) => {
            const homeDirectory = path.resolve('/home/tester');
            const projectDirectory = path.resolve('/work/project');

            tracker.method(fsp, 'stat', async (filepath) => {
                return makeStats(filepath === path.join(projectDirectory, '.kixx'));
            });
            tracker.method(fsp, 'readFile', async (filepath) => {
                if (filepath === path.join(projectDirectory, '.kixx', 'secrets.json')) {
                    return '[ "not", "an", "object" ]';
                }
                return '{}';
            });

            const caught = await catchAsyncError(() => {
                return loadConfiguration({ startDirectory: projectDirectory, homeDirectory });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('UsageError', caught.name);
            assertMatches('Expected a JSON object at the top level of', caught.message);
            assertMatches(path.join(projectDirectory, '.kixx', 'secrets.json'), caught.message);
        });
    });

    it('stops the project search at the home directory', async () => {
        await withMockTracker(async (tracker) => {
            const homeDirectory = path.resolve('/home/tester');
            const startDirectory = path.join(homeDirectory, 'code');
            const statCalls = [];

            tracker.method(fsp, 'stat', async (filepath) => {
                statCalls.push(filepath);
                return makeStats(true);
            });
            tracker.method(fsp, 'readFile', async () => '{}');

            const result = await loadConfiguration({ startDirectory, homeDirectory });

            assertEqual(startDirectory, result.projectDirectory);

            const homeOnly = await loadConfiguration({ startDirectory: homeDirectory, homeDirectory });

            assertEqual(homeDirectory, homeOnly.projectDirectory);
            assertEqual(1, homeOnly.configFilepaths.length);
            assert(!statCalls.includes(path.join(homeDirectory, '.kixx')), 'home .kixx used as a project layer');
        });
    });
});

async function withMockTracker(callback) {
    const tracker = new MockTracker();

    try {
        return await callback(tracker);
    } finally {
        tracker.reset();
    }
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

function makeStats(isDirectory) {
    return {
        isDirectory() {
            return isDirectory;
        },
    };
}

function makeFileSystemError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}
