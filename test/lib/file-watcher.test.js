import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy } from 'kixx-assert';
import FileWatcher from '../../lib/lib/file-watcher.js';


const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));


// -----------------------------------------------------------------------------
// Constructor Validation Tests
// -----------------------------------------------------------------------------

describe('FileWatcher#constructor with valid options', ({ it }) => {
    it('creates instance with resolved absolute directory path', () => {
        const watcher = new FileWatcher({ directory: './src' });
        assertEqual(path.resolve('./src'), watcher.directory);
    });

    it('sets recursive to true by default', () => {
        const watcher = new FileWatcher({ directory: THIS_DIR });
        assertEqual(true, watcher.recursive);
    });

    it('sets recursive to specified value when provided', () => {
        const watcher = new FileWatcher({ directory: THIS_DIR, recursive: false });
        assertEqual(false, watcher.recursive);
    });

    it('accepts includePatterns array', () => {
        const watcher = new FileWatcher({
            directory: THIS_DIR,
            includePatterns: [ '*.js', '*.ts' ],
        });
        assert(watcher);
    });

    it('accepts excludePatterns array', () => {
        const watcher = new FileWatcher({
            directory: THIS_DIR,
            excludePatterns: [ 'node_modules/**' ],
        });
        assert(watcher);
    });
});

describe('FileWatcher#constructor with invalid directory', ({ it }) => {
    it('throws AssertionError when directory is empty string', () => {
        let error;
        try {
            new FileWatcher({ directory: '' });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });

    it('throws AssertionError when directory is null', () => {
        let error;
        try {
            new FileWatcher({ directory: null });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });

    it('throws AssertionError when directory is undefined', () => {
        let error;
        try {
            new FileWatcher({ directory: undefined });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });

    it('throws AssertionError when options is undefined', () => {
        let error;
        try {
            new FileWatcher();
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });
});

describe('FileWatcher#constructor with invalid includePatterns', ({ it }) => {
    it('throws AssertionError when includePatterns is not an array', () => {
        let error;
        try {
            new FileWatcher({ directory: THIS_DIR, includePatterns: '*.js' });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });

    it('throws AssertionError when includePatterns contains empty string', () => {
        let error;
        try {
            new FileWatcher({ directory: THIS_DIR, includePatterns: [ '*.js', '' ] });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });

    it('throws AssertionError when includePatterns contains non-string', () => {
        let error;
        try {
            new FileWatcher({ directory: THIS_DIR, includePatterns: [ '*.js', 123 ] });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });
});

describe('FileWatcher#constructor with invalid excludePatterns', ({ it }) => {
    it('throws AssertionError when excludePatterns is not an array', () => {
        let error;
        try {
            new FileWatcher({ directory: THIS_DIR, excludePatterns: '*.js' });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });

    it('throws AssertionError when excludePatterns contains empty string', () => {
        let error;
        try {
            new FileWatcher({ directory: THIS_DIR, excludePatterns: [ '*.js', '' ] });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });

    it('throws AssertionError when excludePatterns contains non-string', () => {
        let error;
        try {
            new FileWatcher({ directory: THIS_DIR, excludePatterns: [ '*.js', null ] });
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


// -----------------------------------------------------------------------------
// start() Method Tests
// -----------------------------------------------------------------------------

describe('FileWatcher#start() when not yet started', ({ before, after, it }) => {
    let watcher;
    let mockFsWatcher;
    let capturedErrorHandler;

    before(() => {
        mockFsWatcher = {
            on: sinon.stub().callsFake((event, handler) => {
                if (event === 'error') {
                    capturedErrorHandler = handler;
                }
            }),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').returns(mockFsWatcher);

        watcher = new FileWatcher({
            directory: '/tmp/test-dir',
            recursive: true,
        });

        watcher.start();
    });

    after(() => {
        sinon.restore();
    });

    it('calls fs.watch with correct directory', () => {
        assertEqual(1, fs.watch.callCount);
        assertEqual('/tmp/test-dir', fs.watch.getCall(0).args[0]);
    });

    it('calls fs.watch with recursive option', () => {
        const options = fs.watch.getCall(0).args[1];
        assertEqual(true, options.recursive);
    });

    it('registers error handler on watcher', () => {
        assertEqual(1, mockFsWatcher.on.callCount);
        assertEqual('error', mockFsWatcher.on.getCall(0).args[0]);
        assert(capturedErrorHandler);
    });
});

describe('FileWatcher#start() when directory does not exist (ENOENT)', ({ before, after, it }) => {
    let watcher;
    let error;

    before(() => {
        const enoentError = new Error('ENOENT: no such file or directory');
        enoentError.code = 'ENOENT';

        sinon.stub(fs, 'watch').throws(enoentError);

        watcher = new FileWatcher({ directory: '/nonexistent/directory' });

        try {
            watcher.start();
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('does not throw an error', () => {
        assertFalsy(error);
    });

    it('calls fs.watch', () => {
        assertEqual(1, fs.watch.callCount);
    });
});

describe('FileWatcher#start() when fs.watch throws non-ENOENT error', ({ before, after, it }) => {
    let error;
    const originalError = new Error('EACCES: permission denied');
    originalError.code = 'EACCES';

    before(() => {
        sinon.stub(fs, 'watch').throws(originalError);

        const watcher = new FileWatcher({ directory: '/restricted/directory' });

        try {
            watcher.start();
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('rethrows the error', () => {
        assert(error);
        assertEqual(originalError, error);
    });

    it('error has correct code', () => {
        assertEqual('EACCES', error.code);
    });
});

describe('FileWatcher#start() when already started', ({ before, after, it }) => {
    let watcher;
    let error;

    before(() => {
        const mockFsWatcher = {
            on: sinon.stub(),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').returns(mockFsWatcher);

        watcher = new FileWatcher({ directory: THIS_DIR });
        watcher.start();

        try {
            watcher.start();
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws AssertionError', () => {
        assert(error);
        assertEqual('AssertionError', error.name);
    });
});


// -----------------------------------------------------------------------------
// stop() Method Tests
// -----------------------------------------------------------------------------

describe('FileWatcher#stop() when started', ({ before, after, it }) => {
    let mockFsWatcher;

    before(() => {
        mockFsWatcher = {
            on: sinon.stub(),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').returns(mockFsWatcher);

        const watcher = new FileWatcher({ directory: THIS_DIR });
        watcher.start();
        watcher.stop();
    });

    after(() => {
        sinon.restore();
    });

    it('calls close() on the watcher', () => {
        assertEqual(1, mockFsWatcher.close.callCount);
    });
});

describe('FileWatcher#stop() when not started', ({ it }) => {
    it('does not throw', () => {
        let error;
        try {
            const watcher = new FileWatcher({ directory: THIS_DIR });
            watcher.stop();
        } catch (e) {
            error = e;
        }
        assertFalsy(error);
    });
});

describe('FileWatcher#stop() called multiple times', ({ before, after, it }) => {
    let mockFsWatcher;
    let error;

    before(() => {
        mockFsWatcher = {
            on: sinon.stub(),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').returns(mockFsWatcher);

        const watcher = new FileWatcher({ directory: THIS_DIR });
        watcher.start();

        try {
            watcher.stop();
            watcher.stop();
            watcher.stop();
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('does not throw on subsequent calls', () => {
        assertFalsy(error);
    });

    it('only calls close() once', () => {
        assertEqual(1, mockFsWatcher.close.callCount);
    });
});


// -----------------------------------------------------------------------------
// Event Emission Tests (change event)
// -----------------------------------------------------------------------------

describe('FileWatcher emits change event when file matches include patterns', ({ before, after, it }) => {
    let capturedWatchCallback;
    let changeHandler;
    let emittedEvent;

    before(() => {
        const mockFsWatcher = {
            on: sinon.stub(),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').callsFake((directory, options, callback) => {
            capturedWatchCallback = callback;
            return mockFsWatcher;
        });

        const watcher = new FileWatcher({
            directory: '/tmp/test-dir',
            includePatterns: [ '*.js' ],
        });

        changeHandler = sinon.spy();
        watcher.on('change', changeHandler);

        watcher.start();

        // Simulate a file change event
        capturedWatchCallback('change', 'app.js');
        emittedEvent = changeHandler.getCall(0).firstArg;
    });

    after(() => {
        sinon.restore();
    });

    it('emits change event', () => {
        assertEqual(1, changeHandler.callCount);
    });

    it('includes correct eventType', () => {
        assertEqual('change', emittedEvent.eventType);
    });

    it('includes absolute filepath', () => {
        assertEqual('/tmp/test-dir/app.js', emittedEvent.filepath);
    });
});

describe('FileWatcher does not emit change event when file excluded', ({ before, after, it }) => {
    let capturedWatchCallback;
    let changeHandler;

    before(() => {
        const mockFsWatcher = {
            on: sinon.stub(),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').callsFake((directory, options, callback) => {
            capturedWatchCallback = callback;
            return mockFsWatcher;
        });

        const watcher = new FileWatcher({
            directory: '/tmp/test-dir',
            excludePatterns: [ '*.log' ],
        });

        changeHandler = sinon.spy();
        watcher.on('change', changeHandler);

        watcher.start();

        // Simulate a file change event for an excluded file
        capturedWatchCallback('change', 'debug.log');
    });

    after(() => {
        sinon.restore();
    });

    it('does not emit change event', () => {
        assertEqual(0, changeHandler.callCount);
    });
});

describe('FileWatcher with no include patterns includes all files', ({ before, after, it }) => {
    let capturedWatchCallback;
    let changeHandler;

    before(() => {
        const mockFsWatcher = {
            on: sinon.stub(),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').callsFake((directory, options, callback) => {
            capturedWatchCallback = callback;
            return mockFsWatcher;
        });

        const watcher = new FileWatcher({
            directory: '/tmp/test-dir',
        });

        changeHandler = sinon.spy();
        watcher.on('change', changeHandler);

        watcher.start();

        // Simulate file change events for various file types
        capturedWatchCallback('change', 'app.js');
        capturedWatchCallback('change', 'styles.css');
        capturedWatchCallback('change', 'data.json');
    });

    after(() => {
        sinon.restore();
    });

    it('emits change events for all files', () => {
        assertEqual(3, changeHandler.callCount);
    });
});

describe('FileWatcher with include and exclude patterns', ({ before, after, it }) => {
    let capturedWatchCallback;
    let changeHandler;

    before(() => {
        const mockFsWatcher = {
            on: sinon.stub(),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').callsFake((directory, options, callback) => {
            capturedWatchCallback = callback;
            return mockFsWatcher;
        });

        const watcher = new FileWatcher({
            directory: '/tmp/test-dir',
            includePatterns: [ '*.js' ],
            excludePatterns: [ '*.min.js' ],
        });

        changeHandler = sinon.spy();
        watcher.on('change', changeHandler);

        watcher.start();

        // Simulate file change events: app.js and bundle.js are included,
        // app.min.js is excluded, styles.css doesn't match include pattern
        capturedWatchCallback('change', 'app.js');
        capturedWatchCallback('change', 'app.min.js');
        capturedWatchCallback('change', 'bundle.js');
        capturedWatchCallback('change', 'styles.css');
    });

    after(() => {
        sinon.restore();
    });

    it('emits change events only for files matching include but not exclude', () => {
        assertEqual(2, changeHandler.callCount);
    });

    it('first event is for app.js', () => {
        assertEqual('/tmp/test-dir/app.js', changeHandler.getCall(0).firstArg.filepath);
    });

    it('second event is for bundle.js', () => {
        assertEqual('/tmp/test-dir/bundle.js', changeHandler.getCall(1).firstArg.filepath);
    });
});


// -----------------------------------------------------------------------------
// Event Emission Tests (error event)
// -----------------------------------------------------------------------------

describe('FileWatcher emits error event on fs.watch error', ({ before, after, it }) => {
    let capturedErrorHandler;
    let errorHandler;
    let emittedError;
    const originalError = new Error('EACCES: permission denied');

    before(() => {
        const mockFsWatcher = {
            on: sinon.stub().callsFake((event, handler) => {
                if (event === 'error') {
                    capturedErrorHandler = handler;
                }
            }),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').returns(mockFsWatcher);

        const watcher = new FileWatcher({ directory: THIS_DIR });

        errorHandler = sinon.spy();
        watcher.on('error', errorHandler);

        watcher.start();

        // Simulate an error from fs.watch
        capturedErrorHandler(originalError);
        emittedError = errorHandler.getCall(0).firstArg;
    });

    after(() => {
        sinon.restore();
    });

    it('emits error event', () => {
        assertEqual(1, errorHandler.callCount);
    });

    it('emits WrappedError', () => {
        assertEqual('WrappedError', emittedError.name);
    });

    it('WrappedError contains original error as cause', () => {
        assertEqual(originalError, emittedError.cause);
    });
});


// -----------------------------------------------------------------------------
// Glob Pattern Matching Tests
// -----------------------------------------------------------------------------

describe('FileWatcher with glob include patterns for extensions', ({ before, after, it }) => {
    let capturedWatchCallback;
    let changeHandler;

    before(() => {
        const mockFsWatcher = {
            on: sinon.stub(),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').callsFake((directory, options, callback) => {
            capturedWatchCallback = callback;
            return mockFsWatcher;
        });

        const watcher = new FileWatcher({
            directory: '/tmp/test-dir',
            includePatterns: [ '*.js' ],
        });

        changeHandler = sinon.spy();
        watcher.on('change', changeHandler);

        watcher.start();

        capturedWatchCallback('change', 'app.js');
        capturedWatchCallback('change', 'main.js');
        capturedWatchCallback('change', 'styles.css');
        capturedWatchCallback('change', 'data.json');
    });

    after(() => {
        sinon.restore();
    });

    it('matches files with *.js pattern', () => {
        assertEqual(2, changeHandler.callCount);
    });
});

describe('FileWatcher with glob patterns for subdirectories', ({ before, after, it }) => {
    let capturedWatchCallback;
    let changeHandler;

    before(() => {
        const mockFsWatcher = {
            on: sinon.stub(),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').callsFake((directory, options, callback) => {
            capturedWatchCallback = callback;
            return mockFsWatcher;
        });

        const watcher = new FileWatcher({
            directory: '/tmp/test-dir',
            includePatterns: [ '**/*.js' ],
        });

        changeHandler = sinon.spy();
        watcher.on('change', changeHandler);

        watcher.start();

        capturedWatchCallback('change', 'app.js');
        capturedWatchCallback('change', 'src/main.js');
        capturedWatchCallback('change', 'src/lib/utils.js');
        capturedWatchCallback('change', 'styles.css');
    });

    after(() => {
        sinon.restore();
    });

    it('matches files in subdirectories with **/*.js pattern', () => {
        assertEqual(3, changeHandler.callCount);
    });
});

describe('FileWatcher with glob exclude patterns for directories', ({ before, after, it }) => {
    let capturedWatchCallback;
    let changeHandler;

    before(() => {
        const mockFsWatcher = {
            on: sinon.stub(),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').callsFake((directory, options, callback) => {
            capturedWatchCallback = callback;
            return mockFsWatcher;
        });

        const watcher = new FileWatcher({
            directory: '/tmp/test-dir',
            excludePatterns: [ 'node_modules/**' ],
        });

        changeHandler = sinon.spy();
        watcher.on('change', changeHandler);

        watcher.start();

        capturedWatchCallback('change', 'app.js');
        capturedWatchCallback('change', 'node_modules/lodash/index.js');
        capturedWatchCallback('change', 'node_modules/express/lib/router.js');
        capturedWatchCallback('change', 'src/main.js');
    });

    after(() => {
        sinon.restore();
    });

    it('excludes files in node_modules directory', () => {
        assertEqual(2, changeHandler.callCount);
    });

    it('allows files outside excluded directory', () => {
        assertEqual('/tmp/test-dir/app.js', changeHandler.getCall(0).firstArg.filepath);
        assertEqual('/tmp/test-dir/src/main.js', changeHandler.getCall(1).firstArg.filepath);
    });
});

describe('FileWatcher with glob pattern matching dotfiles', ({ before, after, it }) => {
    let capturedWatchCallback;
    let changeHandler;

    before(() => {
        const mockFsWatcher = {
            on: sinon.stub(),
            close: sinon.stub(),
        };

        sinon.stub(fs, 'watch').callsFake((directory, options, callback) => {
            capturedWatchCallback = callback;
            return mockFsWatcher;
        });

        const watcher = new FileWatcher({
            directory: '/tmp/test-dir',
            includePatterns: [ '**/*' ],
        });

        changeHandler = sinon.spy();
        watcher.on('change', changeHandler);

        watcher.start();

        capturedWatchCallback('change', '.gitignore');
        capturedWatchCallback('change', '.env');
        capturedWatchCallback('change', 'src/.hidden/config.js');
    });

    after(() => {
        sinon.restore();
    });

    it('matches dotfiles when dot option is enabled', () => {
        assertEqual(3, changeHandler.callCount);
    });
});
