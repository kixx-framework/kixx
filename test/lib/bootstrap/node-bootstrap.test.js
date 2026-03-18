import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import NodeBootstrap from '../../../lib/bootstrap/node-bootstrap.js';


function createPlugin(name, lifecycleEvents, initializationSnapshots) {
    return {
        register(applicationContext) {
            lifecycleEvents.push(`register:${ name }`);
            applicationContext.registrations.push(name);
        },
        async initialize(applicationContext) {
            lifecycleEvents.push(`initialize:${ name }`);
            initializationSnapshots.push({
                name,
                registrations: [ ...applicationContext.registrations ],
            });
        },
    };
}


describe('NodeBootstrap#loadPlugins() when multiple plugins are provided', ({ before, it }) => {
    const subject = new NodeBootstrap({
        environment: 'development',
        applicationDirectory: '/app',
    });
    const lifecycleEvents = [];
    const initializationSnapshots = [];
    const applicationContext = {
        registrations: [],
    };
    const plugins = new Map([
        [ 'alpha', createPlugin('alpha', lifecycleEvents, initializationSnapshots) ],
        [ 'beta', createPlugin('beta', lifecycleEvents, initializationSnapshots) ],
        [ 'gamma', createPlugin('gamma', lifecycleEvents, initializationSnapshots) ],
    ]);

    before(async () => {
        await subject.loadPlugins(plugins, applicationContext);
    });

    it('registers every plugin before initializing any plugin', () => {
        assertEqual(6, lifecycleEvents.length);
        assertEqual('register:alpha', lifecycleEvents[0]);
        assertEqual('register:beta', lifecycleEvents[1]);
        assertEqual('register:gamma', lifecycleEvents[2]);
        assertEqual('initialize:alpha', lifecycleEvents[3]);
        assertEqual('initialize:beta', lifecycleEvents[4]);
        assertEqual('initialize:gamma', lifecycleEvents[5]);
    });

    it('makes all plugin registrations visible during initialization', () => {
        assertEqual(3, initializationSnapshots.length);
        assertEqual('alpha', initializationSnapshots[0].name);
        assertEqual(3, initializationSnapshots[0].registrations.length);
        assertEqual('alpha', initializationSnapshots[0].registrations[0]);
        assertEqual('beta', initializationSnapshots[0].registrations[1]);
        assertEqual('gamma', initializationSnapshots[0].registrations[2]);
        assertEqual('beta', initializationSnapshots[1].name);
        assertEqual(3, initializationSnapshots[1].registrations.length);
        assertEqual('alpha', initializationSnapshots[1].registrations[0]);
        assertEqual('beta', initializationSnapshots[1].registrations[1]);
        assertEqual('gamma', initializationSnapshots[1].registrations[2]);
        assertEqual('gamma', initializationSnapshots[2].name);
        assertEqual(3, initializationSnapshots[2].registrations.length);
        assertEqual('alpha', initializationSnapshots[2].registrations[0]);
        assertEqual('beta', initializationSnapshots[2].registrations[1]);
        assertEqual('gamma', initializationSnapshots[2].registrations[2]);
    });
});
