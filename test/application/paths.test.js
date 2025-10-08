import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import Paths from '../../lib/application/paths.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_APP_DIR = path.join(THIS_DIR, 'my-projects', 'fake-app');

describe('Application/Paths#constructor with valid input', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Paths(FAKE_APP_DIR);
    });

    it('should have the correct app_directory', () => {
        assertEqual(subject.app_directory, FAKE_APP_DIR);
    });

    it('should have the correct routes_directory', () => {
        assertEqual(subject.routes_directory, path.join(FAKE_APP_DIR, 'routes'));
    });

    it('should have the correct public_directory', () => {
        assertEqual(subject.public_directory, path.join(FAKE_APP_DIR, 'public'));
    });

    it('should have the correct pages_directory', () => {
        assertEqual(subject.pages_directory, path.join(FAKE_APP_DIR, 'pages'));
    });

    it('should have the correct templates_directory', () => {
        assertEqual(subject.templates_directory, path.join(FAKE_APP_DIR, 'templates', 'templates'));
    });

    it('should have the correct helpers_directory', () => {
        assertEqual(subject.helpers_directory, path.join(FAKE_APP_DIR, 'templates', 'helpers'));
    });

    it('should have the correct partials_directory', () => {
        assertEqual(subject.partials_directory, path.join(FAKE_APP_DIR, 'templates', 'partials'));
    });

    it('should have the correct app_plugin_directory', () => {
        assertEqual(subject.app_plugin_directory, path.join(FAKE_APP_DIR, 'app'));
    });

    it('should have the correct plugins_directory', () => {
        assertEqual(subject.plugins_directory, path.join(FAKE_APP_DIR, 'plugins'));
    });

    it('should have the correct commands_directory', () => {
        assertEqual(subject.commands_directory, path.join(FAKE_APP_DIR, 'commands'));
    });

    it('should have the correct data_directory', () => {
        assertEqual(subject.data_directory, path.join(FAKE_APP_DIR, 'data'));
    });

    it('should have the correct kv_store_directory', () => {
        assertEqual(subject.kv_store_directory, path.join(FAKE_APP_DIR, 'data', 'kv-store'));
    });
});

describe('Application/Paths#constructor with invalid input', ({ it }) => {
    it('should throw an AssertionError when applicationDirectory is undefined', () => {
        let error;
        try {
            new Paths();
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('should throw an AssertionError when applicationDirectory is null', () => {
        let error;
        try {
            new Paths(null);
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('should throw an AssertionError when applicationDirectory is an empty string', () => {
        let error;
        try {
            new Paths('');
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('should throw an AssertionError when applicationDirectory is a number', () => {
        let error;
        try {
            new Paths(123);
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('should throw an AssertionError when applicationDirectory is an object', () => {
        let error;
        try {
            new Paths({});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('should throw an AssertionError when applicationDirectory is an array', () => {
        let error;
        try {
            new Paths([]);
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('should throw an AssertionError when applicationDirectory is a boolean', () => {
        let error;
        try {
            new Paths(false);
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});
