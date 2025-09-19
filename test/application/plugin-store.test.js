import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertArray, assertFunction, assertMatches } from 'kixx-assert';
import PluginStore from '../../lib/application/plugin-store.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

function getRandomItem(array) {
    const randomIndex = Math.floor(Math.random() * array.length);
    return array[randomIndex];
}


describe('Application/PluginStore#getPlugin() with no plugin file', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'my-projects', 'fake-app', 'plugins');
    const pluginDirectory = path.join(directory, 'my-plugin');
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
                if (dir === pluginDirectory) {
                    return [{
                        name: 'request-handlers',
                        isDirectory() {
                            return true;
                        },
                    }];
                }
                return [];
            },
        };

        const subject = new PluginStore({ directory, fileSystem });
        result = await subject.getPlugin(pluginDirectory);
    });

    it('returns a PluginInfo object with filepath set to null', () => {
        assertEqual(null, result.filepath);
    });
});

describe('Application/PluginStore#getPlugin() with plugins entry file', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'my-projects', 'fake-app', 'plugins');
    const pluginDirectory = path.join(directory, 'my-plugin');
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
                if (dir === pluginDirectory) {
                    return [{
                        name: getRandomItem([ 'plugin.js', 'plugin.mjs', 'app.js', 'app.mjs' ]),
                        isFile() {
                            return true;
                        },
                    }];
                }
                return [];
            },
        };

        const subject = new PluginStore({ directory, fileSystem });
        result = await subject.getPlugin(pluginDirectory);
    });

    it('returns a PluginInfo object with correct structure', () => {
        const plugin = result;
        assertEqual('my-plugin', plugin.name);
        assertEqual(path.join(directory, 'my-plugin'), plugin.directory);
        assertEqual(path.join(directory, 'my-plugin'), path.dirname(plugin.filepath));
        assert([ 'plugin.js', 'plugin.mjs', 'app.js', 'app.mjs' ].includes(path.basename(plugin.filepath)));
        assertEqual(null, plugin.register);
        assertEqual(null, plugin.initialize);
        assertEqual(path.join(directory, 'my-plugin', 'middleware'), plugin.middlewareDirectory);
        assertEqual(path.join(directory, 'my-plugin', 'request-handlers'), plugin.requestHandlerDirectory);
        assertEqual(path.join(directory, 'my-plugin', 'error-handlers'), plugin.errorHandlerDirectory);
        assertEqual(path.join(directory, 'my-plugin', 'collections'), plugin.collectionsDirectory);
        assertEqual(path.join(directory, 'my-plugin', 'forms'), plugin.formsDirectory);
        assertEqual(path.join(directory, 'my-plugin', 'views'), plugin.viewsDirectory);
    });
});

describe('Application/PluginStore#getPlugins() with multiple plugins', ({ before, it }) => {
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
        result = await subject.getPlugins();
    });

    it('returns multiple PluginInfo objects', () => {
        assertArray(result);
        assertEqual(2, result.length);

        const plugin1 = result[0];
        const plugin2 = result[1];

        assertEqual('plugin1', plugin1.name);
        assertEqual(path.join(directory, 'plugin1'), plugin1.directory);
        assertEqual('plugin2', plugin2.name);
        assertEqual(path.join(directory, 'plugin2'), plugin2.directory);
    });
});

describe('Application/PluginStore#loadPlugins() when plugins are found', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'fixtures', 'app-0', 'plugins');
    let result;

    before(async () => {
        const subject = new PluginStore({ directory });
        result = await subject.loadPlugins();
    });

    it('returns plugins with loaded register and initialize functions', () => {
        assertArray(result);
        assertEqual(1, result.length);

        const plugin = result[0];
        assertEqual('app', plugin.name);
        assertEqual(path.join(directory, 'app'), plugin.directory);
        assertEqual(path.join(directory, 'app', 'plugin.js'), plugin.filepath);
        assertFunction(plugin.register);
        assertFunction(plugin.initialize);
        assertEqual(path.join(directory, 'app', 'middleware'), plugin.middlewareDirectory);
        assertEqual(path.join(directory, 'app', 'request-handlers'), plugin.requestHandlerDirectory);
        assertEqual(path.join(directory, 'app', 'error-handlers'), plugin.errorHandlerDirectory);
        assertEqual(path.join(directory, 'app', 'collections'), plugin.collectionsDirectory);
        assertEqual(path.join(directory, 'app', 'forms'), plugin.formsDirectory);
        assertEqual(path.join(directory, 'app', 'views'), plugin.viewsDirectory);
    });
});

describe('Application/PluginStore#loadPlugins() when plugin does not exist', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'fixtures', 'app-1', 'plugins');
    let result;

    before(async () => {
        const subject = new PluginStore({ directory });
        result = await subject.loadPlugins();
    });

    it('returns PluginInfo objects without register and initialize functions', () => {
        assertArray(result);
        assertEqual(1, result.length);

        const plugin = result[0];
        assertEqual('app', plugin.name);
        assertEqual(path.join(directory, 'app'), plugin.directory);
        assertEqual(null, plugin.filepath);
        assertEqual(null, plugin.register);
        assertEqual(null, plugin.initialize);
    });
});

describe('Application/PluginStore#loadPlugins() when there is a plugin import error', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'fixtures', 'app-3', 'plugins');
    let error;

    before(async () => {
        const subject = new PluginStore({ directory });

        try {
            await subject.loadPlugins();
        } catch (e) {
            error = e;
        }
    });

    it('throws a WrappedError when plugin has import errors', () => {
        assert(error);
        assertEqual('WrappedError', error.name);
        assertEqual('ERR_MODULE_NOT_FOUND', error.code);
        assertEqual('Error loading plugin from ' + path.join(directory, 'app', 'plugin.js'), error.message);

        // Test the cause property
        assert(error.cause);
        assertEqual('ERR_MODULE_NOT_FOUND', error.cause.code);
        assertMatches(/^Cannot find module '([^']+)' imported from/, error.cause.message);
    });
});

describe('Application/PluginStore#loadPlugins() with app plugin directory', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'my-projects', 'fake-app', 'plugins');
    const appPluginDirectory = path.join(THIS_DIR, 'my-projects', 'fake-app', 'app');
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
                if (dir === path.join(directory, 'my-plugin') || dir === appPluginDirectory) {
                    return [{
                        name: getRandomItem([ 'plugin.js', 'plugin.mjs', 'app.js', 'app.mjs' ]),
                        isFile() {
                            return true;
                        },
                    }];
                }
                return [];
            },
            async getFileStats(dir) {
                if (dir === appPluginDirectory) {
                    return {
                        isDirectory() {
                            return true;
                        },
                    };
                }
                return null;
            },
            async importAbsoluteFilepath() {
                return {
                    register: () => {},
                    initialize: () => {},
                };
            },
        };

        const subject = new PluginStore({ directory, fileSystem });
        result = await subject.loadPlugins(appPluginDirectory);
    });

    it('includes app plugin and loads it last', () => {
        assertArray(result);
        assertEqual(2, result.length);

        // First plugin should be from the plugins directory
        const plugin1 = result[0];
        assertEqual('my-plugin', plugin1.name);
        assertEqual(path.join(directory, 'my-plugin'), plugin1.directory);

        // App plugin should be loaded last
        const appPlugin = result[1];
        assertEqual('app', appPlugin.name);
        assertEqual(appPluginDirectory, appPlugin.directory);
        assertEqual(appPluginDirectory, path.dirname(appPlugin.filepath));
        assert([ 'plugin.js', 'plugin.mjs', 'app.js', 'app.mjs' ].includes(path.basename(appPlugin.filepath)));
        assertFunction(appPlugin.register);
        assertFunction(appPlugin.initialize);
    });
});

describe('Application/PluginStore#loadPlugins() with non-existent app plugin directory', ({ before, it }) => {
    const directory = path.join(THIS_DIR, 'my-projects', 'fake-app', 'plugins');
    const appPluginDirectory = path.join(THIS_DIR, 'non-existent', 'app-plugin');
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
            async getFileStats() {
                return null; // Directory doesn't exist
            },
            async importAbsoluteFilepath() {
                return {
                    register: () => {},
                    initialize: () => {},
                };
            },
        };

        const subject = new PluginStore({ directory, fileSystem });
        result = await subject.loadPlugins(appPluginDirectory);
    });

    it('ignores non-existent app plugin directory', () => {
        assertArray(result);
        assertEqual(1, result.length);

        const plugin = result[0];
        assertEqual('my-plugin', plugin.name);
        assertEqual(path.join(directory, 'my-plugin'), plugin.directory);
    });
});

describe('Application/PluginStore#loadPlugins() with null app plugin directory', ({ before, it }) => {
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
            async importAbsoluteFilepath() {
                return {
                    register: () => {},
                    initialize: () => {},
                };
            },
        };

        const subject = new PluginStore({ directory, fileSystem });
        result = await subject.loadPlugins(null);
    });

    it('works without app plugin directory', () => {
        assertArray(result);
        assertEqual(1, result.length);

        const plugin = result[0];
        assertEqual('my-plugin', plugin.name);
        assertEqual(path.join(directory, 'my-plugin'), plugin.directory);
    });
});
