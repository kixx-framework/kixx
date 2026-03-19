import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import * as node from '../../lib/node/mod.js';
import * as mod from '../../lib/mod.js';


describe('lib/node/mod.js exports', ({ it }) => {
    it('exports NodeBootstrap from the node surface', () => {
        assertEqual('function', typeof node.NodeBootstrap);
    });

    it('exports NodeConfigStore from the node surface', () => {
        assertEqual('function', typeof node.NodeConfigStore);
    });
});

describe('lib/mod.js exports', ({ it }) => {
    it('exports HttpRouter', () => {
        assertEqual('function', typeof mod.HttpRouter);
    });

    it('does not export NodeServer from the main surface', () => {
        assertEqual(undefined, mod.NodeServer);
    });
});
