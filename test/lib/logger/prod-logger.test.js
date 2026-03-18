import { describe } from 'kixx-test';
import { assertEqual, assertDefined, assertUndefined } from 'kixx-assert';
import sinon from 'sinon';
import ProdLogger from '../../../lib/logger/prod-logger.js';
import BaseLogger from '../../../lib/logger/base-logger.js';


function parseLogLine(printWriter) {
    return JSON.parse(printWriter.firstCall.firstArg);
}

describe('ProdLogger#printMessage() when a message is logged', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const logger = new ProdLogger({ name: 'app', level: BaseLogger.LEVELS.DEBUG, printWriter });

    before(() => {
        logger.info('hello world');
    });
    after(() => sinon.restore());

    it('calls printWriter once', () => {
        assertEqual(1, printWriter.callCount);
    });

    it('writes a newline-terminated JSON line', () => {
        assertEqual('\n', printWriter.firstCall.firstArg.at(-1));
    });

    it('entry.level is INFO', () => {
        assertEqual('INFO', parseLogLine(printWriter).level);
    });

    it('entry.levelInt is the INFO integer', () => {
        assertEqual(BaseLogger.LEVELS.INFO, parseLogLine(printWriter).levelInt);
    });

    it('entry.name matches the logger name', () => {
        assertEqual('app', parseLogLine(printWriter).name);
    });

    it('entry.message matches the logged message', () => {
        assertEqual('hello world', parseLogLine(printWriter).message);
    });

    it('entry.time is an ISO 8601 timestamp', () => {
        const { time } = parseLogLine(printWriter);
        assertEqual(true, !Number.isNaN(Date.parse(time)));
    });
});

describe('ProdLogger#printMessage() when info is provided', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const logger = new ProdLogger({ name: 'app', printWriter });

    before(() => {
        logger.info('msg', { requestId: 'abc' });
    });
    after(() => sinon.restore());

    it('entry.info contains the provided data', () => {
        assertEqual('abc', parseLogLine(printWriter).info.requestId);
    });
});

describe('ProdLogger#printMessage() when info is not provided', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const logger = new ProdLogger({ name: 'app', printWriter });

    before(() => {
        logger.info('msg');
    });
    after(() => sinon.restore());

    it('entry.info is absent', () => {
        assertUndefined(parseLogLine(printWriter).info);
    });
});

describe('ProdLogger#printMessage() when an error is provided', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const logger = new ProdLogger({ name: 'app', printWriter });
    const cause = new Error('original');
    cause.code = 'ORIGINAL_ERR';

    before(() => {
        logger.error('something failed', null, cause);
    });
    after(() => sinon.restore());

    it('entry.error.name is set', () => {
        assertEqual('Error', parseLogLine(printWriter).error.name);
    });

    it('entry.error.message is set', () => {
        assertEqual('original', parseLogLine(printWriter).error.message);
    });

    it('entry.error.code is set', () => {
        assertEqual('ORIGINAL_ERR', parseLogLine(printWriter).error.code);
    });

    it('entry.error.stack is set', () => {
        assertDefined(parseLogLine(printWriter).error.stack);
    });
});

describe('ProdLogger#printMessage() when error is not provided', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const logger = new ProdLogger({ name: 'app', printWriter });

    before(() => {
        logger.warn('just a warning');
    });
    after(() => sinon.restore());

    it('entry.error is absent', () => {
        assertUndefined(parseLogLine(printWriter).error);
    });
});

describe('ProdLogger#createChild() when called', ({ before, after, it }) => {
    const printWriter = sinon.fake();
    const parent = new ProdLogger({ name: 'app', printWriter });
    let child;

    before(() => {
        child = parent.createChild('db');
        child.info('query executed');
    });
    after(() => sinon.restore());

    it('child uses the same printWriter', () => {
        assertEqual(1, printWriter.callCount);
    });

    it('child name is scoped under the parent name', () => {
        assertEqual('app:db', parseLogLine(printWriter).name);
    });
});
