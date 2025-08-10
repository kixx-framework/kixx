import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertArray } from 'kixx-assert';
import PluginStore from '../../lib/application/plugin-store.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

describe('Application/PluginStore#getPluginPaths() with empty plugins directory', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'my-projects', 'fake-app', 'plugins');
    let result;

    before(async () => {
        const fileSystem = {
            async readDirectory() {
                return [];
            },
        };

        const subject = new PluginStore({ directory, fileSystem });
        result = await subject.getPluginPaths();
    });

    it('returns an empty array', () => {
        assertArray(result);
        assertEqual(0, result.length);
    });
});

describe('Application/PluginStore#getPluginPaths() with no plugin file', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'my-projects', 'fake-app', 'plugins');
    let result;

    before(async () => {
        const fileSystem = {
            async readDirectory(dir) {
                if (dir === directory) {
                    return [{
                        name: 'my-plugin',
                        isDirectory() {
                            return true;
                        },
                    }];
                }
                if (dir === path.join(directory, 'my-plugin')) {
                    return [];
                }
                return [];
            },
        };

        const subject = new PluginStore({ directory, fileSystem });
        result = await subject.getPluginPaths();
    });

    it('returns a PluginInfo object with filepath set to null', () => {
        assertArray(result);
        assertEqual(1, result.length);
        assertEqual(null, result[0].filepath);
    });
});

describe('Application/PluginStore#getPluginPaths() with plugin.js file', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'my-projects', 'fake-app', 'plugins');
    let result;

    before(async () => {
        const fileSystem = {
            async readDirectory(dir) {
                if (dir === directory) {
                    return [{
                        name: 'my-plugin',
                        isDirectory() {
                            return true;
                        },
                    }];
                }
                if (dir === path.join(directory, 'my-plugin')) {
                    return [{
                        name: 'plugin.js',
                        isFile() {
                            return true;
                        },
                    }];
                }
                return [];
            },
        };

        const subject = new PluginStore({ directory, fileSystem });
        result = await subject.getPluginPaths();
    });

    it('returns a PluginInfo object with correct structure', () => {
        assertArray(result);
        assertEqual(1, result.length);

        const plugin = result[0];
        assertEqual(path.join(directory, 'my-plugin'), plugin.directory);
        assertEqual(path.join(directory, 'my-plugin', 'plugin.js'), plugin.filepath);
        assertEqual(null, plugin.register);
        assertEqual(null, plugin.initialize);
        assertEqual(path.join(directory, 'my-plugin', 'middleware'), plugin.middlewareDirectory);
        assertEqual(path.join(directory, 'my-plugin', 'request-handlers'), plugin.requestHandlerDirectory);
        assertEqual(path.join(directory, 'my-plugin', 'error-handlers'), plugin.errorHandlerDirectory);
    });
});

describe('Application/PluginStore#getPluginPaths() with plugin.mjs file', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'my-projects', 'fake-app', 'plugins');
    let result;

    before(async () => {
        const fileSystem = {
            async readDirectory(dir) {
                if (dir === directory) {
                    return [{
                        name: 'my-plugin',
                        isDirectory() {
                            return true;
                        },
                    }];
                }
                if (dir === path.join(directory, 'my-plugin')) {
                    return [{
                        name: 'plugin.mjs',
                        isFile() {
                            return true;
                        },
                    }];
                }
                return [];
            },
        };

        const subject = new PluginStore({ directory, fileSystem });
        result = await subject.getPluginPaths();
    });

    it('returns a PluginInfo object with correct structure for .mjs file', () => {
        assertArray(result);
        assertEqual(1, result.length);

        const plugin = result[0];
        assertEqual(path.join(directory, 'my-plugin'), plugin.directory);
        assertEqual(path.join(directory, 'my-plugin', 'plugin.mjs'), plugin.filepath);
        assertEqual(null, plugin.register);
        assertEqual(null, plugin.initialize);
        assertEqual(path.join(directory, 'my-plugin', 'middleware'), plugin.middlewareDirectory);
        assertEqual(path.join(directory, 'my-plugin', 'request-handlers'), plugin.requestHandlerDirectory);
        assertEqual(path.join(directory, 'my-plugin', 'error-handlers'), plugin.errorHandlerDirectory);
    });
});

describe('Application/PluginStore#getPluginPaths() with multiple plugins', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'my-projects', 'fake-app', 'plugins');
    let result;

    before(async () => {
        const fileSystem = {
            async readDirectory(dir) {
                if (dir === directory) {
                    return [
                        { name: 'plugin1', isDirectory() {
                            return true;
                        } },
                        { name: 'plugin2', isDirectory() {
                            return true;
                        } },
                    ];
                }
                return [{
                    name: 'plugin.js',
                    isFile() {
                        return true;
                    },
                }];
            },
        };

        const subject = new PluginStore({ directory, fileSystem });
        result = await subject.getPluginPaths();
    });

    it('returns multiple PluginInfo objects', () => {
        assertArray(result);
        assertEqual(2, result.length);

        const plugin1 = result[0];
        const plugin2 = result[1];

        assertEqual(path.join(directory, 'plugin1'), plugin1.directory);
        assertEqual(path.join(directory, 'plugin2'), plugin2.directory);
    });
});

describe('Application/PluginStore#constructor with invalid input', ({ it }) => {
    it('should throw an AssertionError when directory is undefined', () => {
        let error;
        try {
            new PluginStore({});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('should throw an AssertionError when directory is null', () => {
        let error;
        try {
            new PluginStore({ directory: null });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('should throw an AssertionError when directory is an empty string', () => {
        let error;
        try {
            new PluginStore({ directory: '' });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});
