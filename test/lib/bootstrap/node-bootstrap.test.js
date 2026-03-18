import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import NodeBootstrap from '../../../lib/bootstrap/node-bootstrap.js';
import { testPluginLifecycleConformance } from '../../conformance/plugin.js';

const subject = new NodeBootstrap({
    environment: 'development',
    applicationDirectory: '/app',
});

testPluginLifecycleConformance((plugins, applicationContext) => {
    return subject.loadPlugins(plugins, applicationContext);
});

describe('NodeBootstrap#createConfigStore()', ({ it }) => {
    it('returns the node-specific config store adapter', () => {
        const configStore = subject.createConfigStore();
        assertEqual('NodeConfigStore', configStore.constructor.name);
    });
});
