import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
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

describe('ApplicationBootstrap#createHttpServer()', ({ before, it }) => {
    const mockServer = {};
    const mockApplicationContext = {};
    const mockBootstrap = {
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
        createHttpServer: sinon.fake.returns(mockServer),
    };

    let result;

    before(() => {
        const appBootstrap = new ApplicationBootstrap({
            environment: 'development',
            bootstrap: mockBootstrap,
        });
        result = appBootstrap.createHttpServer(mockApplicationContext, 3000);
    });

    it('delegates to bootstrap with applicationContext and port', () => {
        assertEqual(1, mockBootstrap.createHttpServer.callCount);
        assertEqual(mockApplicationContext, mockBootstrap.createHttpServer.firstCall.args[0]);
        assertEqual(3000, mockBootstrap.createHttpServer.firstCall.args[1]);
    });

    it('returns the server from bootstrap', () => {
        assertEqual(mockServer, result);
    });
});
