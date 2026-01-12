import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';
import Paths from '../../lib/application/paths.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_APP_DIR = path.join(THIS_DIR, 'my-projects', 'fake-app');

describe('Paths#constructor with valid input', ({ before, it }) => {
    let paths;

    before(() => {
        paths = new Paths(FAKE_APP_DIR);
    });

    it('sets the correct app_directory', () => {
        assertEqual(FAKE_APP_DIR, paths.app_directory);
    });

    it('sets the correct routes_directory', () => {
        assertEqual(path.join(FAKE_APP_DIR, 'routes'), paths.routes_directory);
    });

    it('sets the correct public_directory', () => {
        assertEqual(path.join(FAKE_APP_DIR, 'public'), paths.public_directory);
    });

    it('sets the correct pages_directory', () => {
        assertEqual(path.join(FAKE_APP_DIR, 'pages'), paths.pages_directory);
    });

    it('sets the correct templates_directory', () => {
        assertEqual(path.join(FAKE_APP_DIR, 'templates'), paths.templates_directory);
    });

    it('sets the correct app_plugin_directory', () => {
        assertEqual(path.join(FAKE_APP_DIR, 'app'), paths.app_plugin_directory);
    });

    it('sets the correct plugins_directory', () => {
        assertEqual(path.join(FAKE_APP_DIR, 'plugins'), paths.plugins_directory);
    });

    it('sets the correct commands_directory', () => {
        assertEqual(path.join(FAKE_APP_DIR, 'commands'), paths.commands_directory);
    });

    it('sets the correct data_directory', () => {
        assertEqual(path.join(FAKE_APP_DIR, 'data'), paths.data_directory);
    });
});

describe('Paths#constructor when applicationDirectory is undefined', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new Paths();
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertMatches('applicationDirectory must be a non-empty string', error.message);
    });
});


describe('Paths#constructor when applicationDirectory is null', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new Paths(null);
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertMatches('applicationDirectory must be a non-empty string', error.message);
    });
});


describe('Paths#constructor when applicationDirectory is an empty string', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new Paths('');
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertMatches('applicationDirectory must be a non-empty string', error.message);
    });
});


describe('Paths#constructor when applicationDirectory is a number', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new Paths(123);
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertMatches('applicationDirectory must be a non-empty string', error.message);
    });
});


describe('Paths#constructor when applicationDirectory is an object', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new Paths({});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertMatches('applicationDirectory must be a non-empty string', error.message);
    });
});


describe('Paths#constructor when applicationDirectory is an array', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new Paths([]);
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertMatches('applicationDirectory must be a non-empty string', error.message);
    });
});


describe('Paths#constructor when applicationDirectory is a boolean', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new Paths(false);
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertMatches('applicationDirectory must be a non-empty string', error.message);
    });
});
