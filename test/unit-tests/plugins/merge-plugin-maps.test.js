import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { mergePluginMaps } from '../../../src/plugins/merge-plugin-maps.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('mergePluginMaps()', ({ it }) => {

    it('merges two plugin maps into a new Map', () => {
        const general = new Map([[ 'hyperview', { name: 'hyperview' }]]);
        const platform = new Map([[ 'nodeKeyValueStore', { name: 'nodeKeyValueStore' }]]);

        const merged = mergePluginMaps(general, platform);

        assert(merged instanceof Map);
        assertEqual(2, merged.size);
        assertEqual('hyperview', merged.get('hyperview').name);
        assertEqual('nodeKeyValueStore', merged.get('nodeKeyValueStore').name);
    });

    it('returns a new Map rather than mutating either input', () => {
        const general = new Map([[ 'hyperview', { name: 'hyperview' }]]);
        const platform = new Map([[ 'nodeKeyValueStore', { name: 'nodeKeyValueStore' }]]);

        const merged = mergePluginMaps(general, platform);

        assert(merged !== general);
        assert(merged !== platform);
        assertEqual(1, general.size);
        assertEqual(1, platform.size);
    });

    it('lets a platform plugin override a general plugin registered under the same key', () => {
        const generalPlugin = { name: 'general' };
        const platformPlugin = { name: 'platform' };
        const general = new Map([[ 'contentAddressableStore', generalPlugin ]]);
        const platform = new Map([[ 'contentAddressableStore', platformPlugin ]]);

        const merged = mergePluginMaps(general, platform);

        assertEqual(1, merged.size);
        assertEqual(platformPlugin, merged.get('contentAddressableStore'));
    });

    it('throws when generalPlugins is not a Map', () => {
        const error = catchError(() => mergePluginMaps([], new Map()));

        assert(error, 'expected an error to be thrown');
        assertEqual('AssertionError', error.name);
        assertMatches('generalPlugins', error.message);
    });

    it('throws when platformPlugins is not a Map', () => {
        const error = catchError(() => mergePluginMaps(new Map(), null));

        assert(error, 'expected an error to be thrown');
        assertEqual('AssertionError', error.name);
        assertMatches('platformPlugins', error.message);
    });
});
