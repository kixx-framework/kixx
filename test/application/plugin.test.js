import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import sinon from 'sinon';

import Plugin from '../../lib/application/plugin.js';

import { assertEqual } from 'kixx-assert';

// Mock current working directory
const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));


describe('Plugin#loadMiddlewareFunction()', ({ before, after, it }) => {

    function SomeMiddleware() {}

    const filepath = path.join(DIRECTORY, 'some-middleware.js');

    const importAbsoluteFilepath = sinon.stub().resolves({ default: SomeMiddleware });

    const fileSystem = { importAbsoluteFilepath };

    let result;

    before(async () => {
        const plugin = new Plugin(fileSystem, DIRECTORY);
        result = await plugin.loadMiddlewareFunction(filepath);
    });

    after(() => {
        sinon.restore();
    });

    it('returns the default exports', () => {
        assertEqual(SomeMiddleware, result);
    });
});
