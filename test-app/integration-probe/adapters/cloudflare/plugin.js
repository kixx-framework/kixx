import { createPlatformChecks } from './lib/platform-checks.js';
import { createPortFactories } from './lib/port-factories.js';


export function register(context) {
    context.registerService('IntegrationProbe', {
        target: 'cloudflare',
        portFactories: createPortFactories({
            // The Workers scheduler is looked up when a test waits, not
            // here: reading the global at registration would throw wherever
            // it doesn't exist, as in a unit test.
            wait: (milliseconds) => scheduler.wait(milliseconds),
            createId: () => crypto.randomUUID(),
        }),
        platformChecks: createPlatformChecks({
            now: () => Date.now(),
            createId: () => crypto.randomUUID(),
            // This context holds the environment the Worker booted with, at
            // module scope. Names only.
            bootEnvironmentNames: Object.keys(context.env),
        }),
    });
}
