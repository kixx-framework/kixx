import { describe } from 'kixx-test';
import { assertEqual, assertGreaterThan, assertNumberNotNaN } from 'kixx-assert';
import TraceLogger from '../../../../src/kixx/logger/trace-logger.js';


describe('TraceLogger', ({ describe }) => {
    for (const status of [ 'ok', 'error' ]) {
        describe(status, ({ it }) => {
            it('logs without constructor or completion info', () => {
                const { trace, entries } = makeSubject();

                trace[status]();

                assertEqual(1, entries.length);
                assertEqual('trace test-span', entries[0].message);
                assertEqual(status, entries[0].info.status);
                assertNumberNotNaN(entries[0].info.duration);
            });

            it('preserves constructor info when completion info is omitted', () => {
                const { trace, entries } = makeSubject({ requestId: 'request-1' });

                trace[status]();

                assertEqual('request-1', entries[0].info.requestId);
            });

            it('accepts completion info without constructor info', () => {
                const { trace, entries } = makeSubject();

                trace[status]({ pathname: '/users' });

                assertEqual('/users', entries[0].info.pathname);
            });

            it('merges info without mutation and protects generated fields', () => {
                const initialInfo = Object.freeze({
                    requestId: 'request-1',
                    pathname: '/initial',
                    status: 'initial',
                    duration: -2,
                });
                const completionInfo = Object.freeze({
                    pathname: '/users',
                    status: 'completion',
                    duration: -1,
                });
                const { trace, entries } = makeSubject(initialInfo);

                trace[status](completionInfo);

                const { info } = entries[0];
                assertEqual('request-1', info.requestId);
                assertEqual('/users', info.pathname);
                assertEqual(status, info.status);
                assertNumberNotNaN(info.duration);
                assertGreaterThan(-1, info.duration);
                assertEqual('/initial', initialInfo.pathname);
                assertEqual('initial', initialInfo.status);
                assertEqual(-2, initialInfo.duration);
                assertEqual('completion', completionInfo.status);
                assertEqual(-1, completionInfo.duration);
            });
        });
    }
});

function makeSubject(info) {
    const entries = [];
    const logger = {
        info(message, entryInfo) {
            entries.push({ message, info: entryInfo });
        },
    };

    return {
        trace: new TraceLogger(logger, 'test-span', info),
        entries,
    };
}
