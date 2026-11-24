import { describe, MockTracker } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import LoggerWriter from '../../../../../../kixx/adapters/cloudflare/logger-writer/lib/logger-writer.js';
import loggerWriterConformance from '../../../../logger/logger-writer-conformance.js';


// A stand-in for the console that records which method received each line.
function makeConsoleSink() {
    const calls = [];
    const sink = {};

    for (const method of [ 'debug', 'info', 'warn', 'error' ]) {
        sink[method] = (line) => {
            calls.push({ method, line });
        };
    }

    return { sink, calls };
}

function makeLoggerWriter() {
    const { sink, calls } = makeConsoleSink();

    return {
        writer: new LoggerWriter({ console: sink }),
        lines: () => calls.map(({ line }) => line),
    };
}


describe('Cloudflare LoggerWriter', ({ describe }) => {

    loggerWriterConformance(describe, makeLoggerWriter);

    describe('write', ({ it }) => {
        it('writes each entry to the console method that matches its level', () => {
            const { sink, calls } = makeConsoleSink();
            const writer = new LoggerWriter({ console: sink });

            writer.write('App', 10, 'DEBUG', 'debug message');
            writer.write('App', 20, 'INFO', 'info message');
            writer.write('App', 30, 'WARN', 'warn message');
            writer.write('App', 40, 'ERROR', 'error message');

            assertEqual('debug,info,warn,error', calls.map(({ method }) => method).join(','));
            assertEqual(
                'debug message,info message,warn message,error message',
                calls.map(({ line }) => JSON.parse(line).message).join(','),
            );
        });

        // The one case that patches the global: it pins the default sink.
        it('writes to the global console when no sink is given', () => {
            const tracker = new MockTracker();
            const warnMock = tracker.method(console, 'warn', () => {});

            try {
                const writer = new LoggerWriter();

                writer.write('App', 30, 'WARN', 'heads up', { requestId: 'abc' });

                assertEqual(1, warnMock.mock.callCount());

                const entry = JSON.parse(warnMock.mock.getCall(0).arguments[0]);
                assertEqual(30, entry.levelCode);
                assertEqual('heads up', entry.message);
                assertEqual('abc', entry.info.requestId);
            } finally {
                tracker.reset();
            }
        });
    });
});
