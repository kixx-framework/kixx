import process from 'node:process';
import { describe, MockTracker } from 'kixx-test';
import { assertEqual, assertMatches } from 'kixx-assert';

import LoggerWriter from '../../../../../../kixx/adapters/node/logger-writer/lib/logger-writer.js';
import loggerWriterConformance from '../../../../logger/logger-writer-conformance.js';


// A stand-in for a process stream that records each chunk written to it.
function makeStreamSink() {
    const chunks = [];
    const stream = {
        write(chunk) {
            chunks.push(chunk);
            return true;
        },
    };

    return { stream, chunks };
}

function makeLoggerWriter() {
    // One sink for both streams keeps the lines in call order.
    const { stream, chunks } = makeStreamSink();

    return {
        writer: new LoggerWriter({ stdout: stream, stderr: stream }),
        lines: () => chunks.map((chunk) => chunk.replace(/\n$/, '')),
    };
}


describe('Node LoggerWriter', ({ describe }) => {

    loggerWriterConformance(describe, makeLoggerWriter);

    describe('write', ({ it }) => {
        it('writes DEBUG and INFO entries to stdout as newline-terminated JSON', () => {
            const stdout = makeStreamSink();
            const stderr = makeStreamSink();
            const writer = new LoggerWriter({ stdout: stdout.stream, stderr: stderr.stream });

            writer.write('App', 10, 'DEBUG', 'debug message');
            writer.write('App', 20, 'INFO', 'info message', { requestId: 'abc' });

            assertEqual(2, stdout.chunks.length);
            assertEqual(0, stderr.chunks.length);
            assertMatches(/\n$/, stdout.chunks[0]);
            assertMatches(/\n$/, stdout.chunks[1]);

            const debugEntry = JSON.parse(stdout.chunks[0]);
            assertEqual(10, debugEntry.levelCode);
            assertEqual('debug message', debugEntry.message);

            const infoEntry = JSON.parse(stdout.chunks[1]);
            assertEqual(20, infoEntry.levelCode);
            assertEqual('info message', infoEntry.message);
        });

        it('writes WARN and ERROR entries to stderr as newline-terminated JSON', () => {
            const stdout = makeStreamSink();
            const stderr = makeStreamSink();
            const writer = new LoggerWriter({ stdout: stdout.stream, stderr: stderr.stream });

            writer.write('App', 30, 'WARN', 'warning');
            writer.write('App', 40, 'ERROR', 'failure');

            assertEqual(0, stdout.chunks.length);
            assertEqual(2, stderr.chunks.length);
            assertMatches(/\n$/, stderr.chunks[0]);
            assertMatches(/\n$/, stderr.chunks[1]);

            const warnEntry = JSON.parse(stderr.chunks[0]);
            assertEqual(30, warnEntry.levelCode);
            assertEqual('warning', warnEntry.message);

            const errorEntry = JSON.parse(stderr.chunks[1]);
            assertEqual(40, errorEntry.levelCode);
            assertEqual('failure', errorEntry.message);
        });

        // The one case that patches the globals: it pins the default streams.
        it('writes to the process streams when none are given', () => {
            const tracker = new MockTracker();
            const stdoutMock = tracker.method(process.stdout, 'write', () => true);
            const stderrMock = tracker.method(process.stderr, 'write', () => true);

            try {
                const writer = new LoggerWriter();

                writer.write('App', 20, 'INFO', 'info message');
                writer.write('App', 40, 'ERROR', 'failure');

                assertEqual(1, stdoutMock.mock.callCount());
                assertEqual(1, stderrMock.mock.callCount());
                assertEqual('info message', JSON.parse(stdoutMock.mock.getCall(0).arguments[0]).message);
                assertEqual('failure', JSON.parse(stderrMock.mock.getCall(0).arguments[0]).message);
            } finally {
                tracker.reset();
            }
        });
    });
});
