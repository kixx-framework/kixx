import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Paths from '../../../application/paths.js';
import { describe } from 'kixx-test';
import { assertEqual, assertArray } from 'kixx-assert';


const thisDirectory = path.dirname(fileURLToPath(import.meta.url));


describe('Paths:getPlugins() - when plugins directory is not present', ({ before, it }) => {
    const paths = new Paths(thisDirectory);
    let plugins;

    before(async () => {
        plugins = await paths.getPlugins();
    });

    it('returns an empty array', () => {
        assertArray(plugins);
        assertEqual(0, plugins.length);
    });
});

describe('Paths:getPlugins() - when a plugin is present', ({ before, it }) => {
    const pluginsDirectory = path.join(thisDirectory, 'plugins');

    async function readDirectory(dirpath) {
        if (dirpath === pluginsDirectory) {
            return [
                path.join(dirpath, 'not_a_plugin'),
                path.join(dirpath, 'a_plugin'),
            ];
        }
        if (dirpath === path.join(pluginsDirectory, 'not_a_plugin')) {
            return [
                path.join(pluginsDirectory, 'not_a_plugin', 'foo'),
                path.join(pluginsDirectory, 'not_a_plugin', 'bar'),
                path.join(pluginsDirectory, 'not_a_plugin', 'plugin-this-is-not.js'),
            ];
        }
        if (dirpath === path.join(pluginsDirectory, 'a_plugin')) {
            return [
                path.join(pluginsDirectory, 'a_plugin', 'foo'),
                path.join(pluginsDirectory, 'a_plugin', 'middleware'),
                path.join(pluginsDirectory, 'a_plugin', 'plugin.js'),
                path.join(pluginsDirectory, 'a_plugin', 'request-handlers'),
                path.join(pluginsDirectory, 'a_plugin', 'error-handlers'),
            ];
        }

        throw new Error(`Unexpected directory: ${ dirpath }`);
    }

    const fileSystem = { readDirectory };
    const paths = new Paths(thisDirectory, { fileSystem });
    let plugins;

    before(async () => {
        plugins = await paths.getPlugins();
    });

    it('returns a plugin filepath structure', () => {
        assertArray(plugins);
        assertEqual(1, plugins.length);
        assertEqual(path.join(pluginsDirectory, 'a_plugin'), plugins[0].directory);
        assertEqual(path.join(pluginsDirectory, 'a_plugin', 'plugin.js'), plugins[0].filepath);
        assertEqual(path.join(pluginsDirectory, 'a_plugin', 'middleware'), plugins[0].middlewareDirectory);
        assertEqual(path.join(pluginsDirectory, 'a_plugin', 'request-handlers'), plugins[0].requestHandlerDirectory);
        assertEqual(path.join(pluginsDirectory, 'a_plugin', 'error-handlers'), plugins[0].errorHandlerDirectory);
    });
});
