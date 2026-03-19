import ApplicationBootstrap from '../../../lib/bootstrap/application-bootstrap.js';
import { testPluginLifecycleConformance } from '../../conformance/plugin.js';


function createMockBootstrap() {
    return {
        applicationDirectory: '/app',
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

const subject = new ApplicationBootstrap({
    environment: 'development',
    bootstrap: createMockBootstrap(),
});

testPluginLifecycleConformance((plugins, applicationContext) => {
    return subject.loadPlugins(plugins, applicationContext);
});
