import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { createKeyCounter } from './lib/key-counter.js';
import { createPortFactories } from './lib/port-factories.js';


export function register(context) {
    const { config } = context;

    context.registerService('IntegrationProbe', {
        target: 'node',
        portFactories: createPortFactories({
            resolveFilepath: config.resolveFilepath,
            createId: () => crypto.randomUUID(),
        }),
        countKeyValueKeys: createKeyCounter({
            DatabaseSync,
            fileExists: fs.existsSync,
            // Where the Node.js key/value store's own plugin puts its file.
            path: config.resolveFilepath(config.env.KEY_VALUE_STORE.path),
        }),
    });
}
