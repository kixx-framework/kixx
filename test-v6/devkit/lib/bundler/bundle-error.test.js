import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import BundleError from '../../../lib/bundler/bundle-error.js';

describe('BundleError', ({ it }) => {
    it('exposes a defensive copy of its diagnostics', () => {
        const diagnostics = [ makeDiagnostic() ];
        const error = new BundleError(diagnostics);

        assertEqual('BundleError', error.name);
        assertEqual('BundleError', error.code);
        assert(Object.hasOwn(error, 'name'));
        assert(Object.hasOwn(error, 'code'));
        assertEqual(true, Object.getOwnPropertyDescriptor(error, 'name').enumerable);
        assertEqual(true, Object.getOwnPropertyDescriptor(error, 'code').enumerable);
        assertEqual(false, error.diagnostics === diagnostics);
        assertEqual(diagnostics[0], error.diagnostics[0]);

        diagnostics.push(makeDiagnostic({ specifier: './later.js' }));

        assertEqual(1, error.diagnostics.length);
    });

    it('formats every distinct diagnostic with its source location', () => {
        const error = new BundleError([
            makeDiagnostic(),
            makeDiagnostic({
                importer: './other.js',
                specifier: 'package',
                line: 8,
                column: 2,
                message: 'Bare specifiers must be declared external.',
            }),
        ]);

        assertMatches('2 diagnostics', error.message);
        assertMatches('./entry.js:4:6', error.message);
        assertMatches('import "./missing.js"', error.message);
        assertMatches('./other.js:8:2', error.message);
        assertMatches('import "package"', error.message);
    });

    it('formats exact duplicate diagnostics once', () => {
        const diagnostic = makeDiagnostic();
        const error = new BundleError([ diagnostic, diagnostic, { ...diagnostic } ]);

        assertMatches('1 diagnostic', error.message);
        assertEqual(1, countOccurrences(error.message, './entry.js:4:6'));
    });

    it('formats entry-level diagnostics without null', () => {
        const error = new BundleError([
            makeDiagnostic({
                importer: null,
                specifier: null,
            }),
        ]);

        assertMatches('entry:4:6', error.message);
        assertEqual(false, error.message.includes('null'));
    });
});

function makeDiagnostic(overrides) {
    return {
        importer: './entry.js',
        specifier: './missing.js',
        line: 4,
        column: 6,
        message: 'Module does not exist.',
        ...overrides,
    };
}

function countOccurrences(value, search) {
    return value.split(search).length - 1;
}
