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
    });
}
