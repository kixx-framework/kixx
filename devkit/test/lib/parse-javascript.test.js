import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import { parseJavaScript } from '../../lib/parse-javascript.js';


const MODULE_OPTIONS = {
    ecmaVersion: 'latest',
    sourceType: 'module',
};


describe('parseJavaScript', ({ it }) => {
    it('returns the Program AST and passes options to acorn', () => {
        const ast = parseJavaScript('export const value = 1;', {
            ...MODULE_OPTIONS,
            locations: true,
        });

        assertEqual('Program', ast.type);
        assertEqual('ExportNamedDeclaration', ast.body[0].type);
        assertEqual(1, ast.body[0].loc.start.line);
    });

    it('adds lineNumber and column from loc to a syntax error', () => {
        const source = [
            'const first = 1;',
            'const second = 2;',
            'const = 3;',
        ].join('\n');
        const caught = catchError(() => parseJavaScript(source, MODULE_OPTIONS));

        assert(caught, 'expected a syntax error');
        assert(caught instanceof SyntaxError);
        assertEqual(3, caught.lineNumber);
        assertEqual(caught.loc.line, caught.lineNumber);
        assertEqual(caught.loc.column, caught.column);
    });

    it('rethrows the error acorn raised', () => {
        const caught = catchError(() => parseJavaScript('export const = 1;', MODULE_OPTIONS));

        assert(caught, 'expected a syntax error');
        assertEqual('number', typeof caught.pos);
        assertEqual('number', typeof caught.raisedAt);
    });
});

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }

    return null;
}
