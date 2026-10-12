import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import BaseContext from '../../../../src/kixx/context/base-context.js';


function makeBaseContext(options) {
    const {
        config = { name: 'test-app' },
        env = {},
        logger = { name: 'test-logger' },
        runtime = { mode: 'server' },
    } = options ?? {};

    return new BaseContext({ config, env, logger, runtime });
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('BaseContext', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('assigns config, env, logger, and runtime as enumerable read-only properties', () => {
            const config = { name: 'app' };
            const env = { NODE_ENV: 'test' };
            const logger = { name: 'app' };
            const runtime = { mode: 'server' };

            const context = new BaseContext({ config, env, logger, runtime });

            assertEqual(config, context.config);
            assertEqual(env, context.env);
            assertEqual(logger, context.logger);
            assertEqual(runtime, context.runtime);
            assert(Object.keys(context).includes('config'), 'expected config to be enumerable');
            assert(Object.keys(context).includes('env'), 'expected env to be enumerable');
            assert(Object.keys(context).includes('logger'), 'expected logger to be enumerable');
            assert(Object.keys(context).includes('runtime'), 'expected runtime to be enumerable');

            const caught = catchError(() => {
                context.config = {};
            });
            assert(caught, 'expected reassigning config to throw');
            assertEqual('TypeError', caught.name);
        });

        it('leaves config undefined when omitted', () => {
            const context = new BaseContext({ env: {}, logger: {}, runtime: {} });

            assertUndefined(context.config);
        });
    });

    describe('getEnvString', ({ it }) => {
        it('returns the string value when present', () => {
            const context = makeBaseContext({ env: { NAME: 'kixx' } });

            assertEqual('kixx', context.getEnvString('NAME'));
        });

        it('returns undefined when missing or empty and not required', () => {
            assertUndefined(makeBaseContext().getEnvString('MISSING'));
            assertUndefined(makeBaseContext({ env: { NAME: '' } }).getEnvString('NAME'));
        });

        it('throws an AssertionError when required and missing', () => {
            const context = makeBaseContext();

            const caught = catchError(() => context.getEnvString('MISSING', { required: true }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('required', caught.message);
        });
    });

    describe('getEnvInteger', ({ it }) => {
        it('parses a base-10 integer string', () => {
            const context = makeBaseContext({ env: { PORT: '8080' } });

            assertEqual(8080, context.getEnvInteger('PORT'));
        });

        it('returns a number value already stored as an integer', () => {
            const context = makeBaseContext({ env: { PORT: 3000 } });

            assertEqual(3000, context.getEnvInteger('PORT'));
        });

        it('throws an AssertionError for a float number', () => {
            const context = makeBaseContext({ env: { PORT: 1.5 } });

            const caught = catchError(() => context.getEnvInteger('PORT'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError for an unparseable string', () => {
            const context = makeBaseContext({ env: { PORT: 'abc' } });

            const caught = catchError(() => context.getEnvInteger('PORT'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('returns undefined when missing and not required', () => {
            const context = makeBaseContext();

            assertUndefined(context.getEnvInteger('PORT'));
        });

        it('throws an AssertionError when required and missing', () => {
            const context = makeBaseContext();

            const caught = catchError(() => context.getEnvInteger('PORT', { required: true }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('required', caught.message);
        });
    });

    describe('getEnvFloat', ({ it }) => {
        it('parses a float string', () => {
            const context = makeBaseContext({ env: { RATE: '1.5' } });

            assertEqual(1.5, context.getEnvFloat('RATE'));
        });

        it('returns a number value already stored as a float', () => {
            const context = makeBaseContext({ env: { RATE: 2.25 } });

            assertEqual(2.25, context.getEnvFloat('RATE'));
        });

        it('throws an AssertionError for an unparseable string', () => {
            const context = makeBaseContext({ env: { RATE: 'abc' } });

            const caught = catchError(() => context.getEnvFloat('RATE'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('returns undefined when missing and not required', () => {
            const context = makeBaseContext();

            assertUndefined(context.getEnvFloat('RATE'));
        });

        it('throws an AssertionError when required and missing', () => {
            const context = makeBaseContext();

            const caught = catchError(() => context.getEnvFloat('RATE', { required: true }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('required', caught.message);
        });
    });

    describe('getEnvBoolean', ({ it }) => {
        it('returns true for recognized truthy values', () => {
            assertEqual(true, makeBaseContext({ env: { F: true } }).getEnvBoolean('F'));
            assertEqual(true, makeBaseContext({ env: { F: 1 } }).getEnvBoolean('F'));
            assertEqual(true, makeBaseContext({ env: { F: 'true' } }).getEnvBoolean('F'));
            assertEqual(true, makeBaseContext({ env: { F: '1' } }).getEnvBoolean('F'));
        });

        it('returns false for recognized falsy values', () => {
            assertEqual(false, makeBaseContext({ env: { F: false } }).getEnvBoolean('F'));
            assertEqual(false, makeBaseContext({ env: { F: 0 } }).getEnvBoolean('F'));
            assertEqual(false, makeBaseContext({ env: { F: 'false' } }).getEnvBoolean('F'));
            assertEqual(false, makeBaseContext({ env: { F: '0' } }).getEnvBoolean('F'));
        });

        it('returns false for missing or unrecognized values', () => {
            assertEqual(false, makeBaseContext().getEnvBoolean('MISSING'));
            assertEqual(false, makeBaseContext({ env: { F: 'maybe' } }).getEnvBoolean('F'));
        });
    });
});
