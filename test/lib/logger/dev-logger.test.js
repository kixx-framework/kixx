import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from 'kixx-assert';
import sinon from 'sinon';
import DevLogger from '../../../lib/logger/dev-logger.js';
import BaseLogger from '../../../lib/logger/base-logger.js';


describe('DevLogger#printMessage() when level is DEBUG', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const logger = new DevLogger({ name: 'test', level: BaseLogger.LEVELS.DEBUG, printWriter });

    before(() => {
        logger.debug('a debug message');
    });
    after(() => sinon.restore());

    it('calls printWriter once', () => {
        assertEqual(1, printWriter.callCount);
    });

    it('writes a line ending with a newline', () => {
        assertMatches(/\n$/, printWriter.firstCall.firstArg);
    });

    it('includes the level label', () => {
        assertMatches('DEBUG', printWriter.firstCall.firstArg);
    });

    it('includes the logger name', () => {
        assertMatches('test', printWriter.firstCall.firstArg);
    });

    it('includes the message', () => {
        assertMatches('a debug message', printWriter.firstCall.firstArg);
    });
});

describe('DevLogger#printMessage() when level is WARN', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const logger = new DevLogger({ name: 'test', printWriter });

    before(() => {
        logger.warn('a warning');
    });
    after(() => sinon.restore());

    it('applies yellow ANSI color to the prefix', () => {
        // ANSI yellow: ESC[33m
        assertMatches('\x1b[33m', printWriter.firstCall.firstArg);
    });
});

describe('DevLogger#printMessage() when level is ERROR', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const logger = new DevLogger({ name: 'test', printWriter });

    before(() => {
        logger.error('an error');
    });
    after(() => sinon.restore());

    it('applies red ANSI color to the prefix', () => {
        // ANSI red: ESC[31m
        assertMatches('\x1b[31m', printWriter.firstCall.firstArg);
    });
});

describe('DevLogger#printMessage() when info is provided', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const logger = new DevLogger({ name: 'test', printWriter });

    before(() => {
        logger.info('msg', { key: 'value' });
    });
    after(() => sinon.restore());

    it('includes the JSON-serialized info in the output', () => {
        assertMatches('{"key":"value"}', printWriter.firstCall.firstArg);
    });
});

describe('DevLogger#printMessage() when info is not provided', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const logger = new DevLogger({ name: 'test', printWriter });

    before(() => {
        logger.info('msg');
    });
    after(() => sinon.restore());

    it('does not append a trailing info fragment', () => {
        // Just the timestamp, level, name, message, and newline — no JSON suffix
        assertMatches(/^[\d:.]+ \[INFO {1}\] test msg\n$/, printWriter.firstCall.firstArg);
    });
});

describe('DevLogger#createChild() when called', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const parent = new DevLogger({ name: 'app', printWriter });
    let child;

    before(() => {
        child = parent.createChild('sub');
        child.info('child message');
    });
    after(() => sinon.restore());

    it('child uses the same printWriter', () => {
        assertEqual(1, printWriter.callCount);
    });

    it('child name is scoped under the parent name', () => {
        assertMatches('app:sub', printWriter.firstCall.firstArg);
    });
});
