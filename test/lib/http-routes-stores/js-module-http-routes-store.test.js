import { describe } from 'kixx-test';
import { assertEqual, assertArray } from 'kixx-assert';
import JSModuleHttpRoutesStore from '../../../lib/http-routes-stores/js-module-http-routes-store.js';
import { testHttpRoutesStoreConformance } from '../../conformance/http-routes-store.js';


testHttpRoutesStoreConformance(() => new JSModuleHttpRoutesStore([]));


describe('JSModuleHttpRoutesStore constructor when vhostsConfigs is not an Array', ({ it }) => {
    it('throws an Error', () => {
        let error;
        try {
            new JSModuleHttpRoutesStore(null);
        } catch (err) {
            error = err;
        }
        assertEqual('Error', error.name);
    });
});

describe('JSModuleHttpRoutesStore#loadVirtualHosts() when configured with an empty array', ({ before, it }) => {
    let result;

    before(async () => {
        const store = new JSModuleHttpRoutesStore([]);
        result = await store.loadVirtualHosts();
    });

    it('resolves with an empty Array', () => {
        assertArray(result);
        assertEqual(0, result.length);
    });
});
