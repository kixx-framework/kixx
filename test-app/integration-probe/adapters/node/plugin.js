import { createPortFactories } from './lib/port-factories.js';


export function register(context) {
    context.registerService('IntegrationProbe', {
        target: 'node',
        portFactories: createPortFactories({
            resolveFilepath: context.config.resolveFilepath,
            createId: () => crypto.randomUUID(),
        }),
    });
}
