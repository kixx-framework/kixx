import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import NodeBootstrap from '../../../lib/node/bootstrap/node-bootstrap.js';

const subject = new NodeBootstrap({
    applicationDirectory: '/app',
});

describe('NodeBootstrap#createConfigStore()', ({ it }) => {
    it('returns the node-specific config store adapter', () => {
        const configStore = subject.createConfigStore();
        assertEqual('NodeConfigStore', configStore.constructor.name);
    });
});

describe('NodeBootstrap#createHttpRoutesStore()', ({ it }) => {
    it('returns the JS module routes store adapter', () => {
        const store = subject.createHttpRoutesStore([]);
        assertEqual('MemoryHttpRoutesStore', store.constructor.name);
    });
});

describe('NodeBootstrap#getPrintWriter()', ({ it }) => {
    it('returns a function', () => {
        const printWriter = subject.getPrintWriter();
        assertEqual('function', typeof printWriter);
    });
});
