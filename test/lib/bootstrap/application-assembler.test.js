import ApplicationAssembler from '../../../lib/bootstrap/application-assembler.js';
import { testPluginLifecycleConformance } from '../../conformance/plugin.js';


function createMockBootstrap() {
    return {
        createConfigStore() {
            return null;
        },
        createHttpRoutesStore() {
            return null;
        },
        getPrintWriter() {
            return null;
        },
    };
}

const subject = new ApplicationAssembler({
    environment: 'development',
    applicationDirectory: '/app',
    bootstrap: createMockBootstrap(),
});

testPluginLifecycleConformance((plugins, applicationContext) => {
    return subject.loadPlugins(plugins, applicationContext);
});
