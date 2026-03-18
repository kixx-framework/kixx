import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import * as core from '../../lib/core/mod.js';
import * as node from '../../lib/node/mod.js';
import * as mod from '../../lib/mod.js';


describe('lib/core/mod.js exports', ({ it }) => {
    it('exports HttpRouter from the core surface', () => {
        assertEqual('function', typeof core.HttpRouter);
    });

    it('does not export NodeServer from the core surface', () => {
        assertEqual(undefined, core.NodeServer);
    });
});

describe('lib/node/mod.js exports', ({ it }) => {
    it('exports NodeBootstrap from the node surface', () => {
        assertEqual('function', typeof node.NodeBootstrap);
    });

    it('exports NodeConfigStore from the node surface', () => {
        assertEqual('function', typeof node.NodeConfigStore);
    });
});

describe('lib/mod.js exports', ({ it }) => {
    it('re-exports the core surface', () => {
        assertEqual(core.HttpRouter, mod.HttpRouter);
    });

    it('re-exports the node surface', () => {
        assertEqual(node.NodeBootstrap, mod.NodeBootstrap);
    });
});
