import { describe } from 'kixx-test';
import { assertEqual, assertArray } from 'kixx-assert';
import MemoryHttpRoutesStore from '../../../lib/http-routes-stores/memory-http-routes-store.js';
import { testHttpRoutesStoreConformance } from '../../conformance/http-routes-store.js';


testHttpRoutesStoreConformance(() => new MemoryHttpRoutesStore([]));


describe('MemoryHttpRoutesStore constructor when vhostsConfigs is not an Array', ({ it }) => {
    it('throws an Error', () => {
        let error;
        try {
            new MemoryHttpRoutesStore(null);
        } catch (err) {
            error = err;
        }
        assertEqual('Error', error.name);
    });
});

describe('MemoryHttpRoutesStore#loadVirtualHosts() when configured with an empty array', ({ before, it }) => {
    let result;

    before(async () => {
        const store = new MemoryHttpRoutesStore([]);
        result = await store.loadVirtualHosts();
    });

    it('resolves with an empty Array', () => {
        assertArray(result);
        assertEqual(0, result.length);
    });
});
