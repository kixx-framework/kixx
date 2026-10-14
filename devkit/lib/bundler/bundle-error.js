/**
 * @typedef {Object} Diagnostic
 * @property {string|null} importer - Module key that contains the problem, or null for an entry-level problem.
 * @property {string|null} specifier - Import specifier that caused the problem, or null for a whole-module problem.
 * @property {number} line - One-based source line where the problem occurred.
 * @property {number} column - Zero-based source column where the problem occurred.
 * @property {string} message - Complete human-readable explanation of the problem.
 */

export default class BundleError extends Error {

    /**
     * @param {Diagnostic[]} diagnostics - Problems found while crawling a module graph.
     */
    constructor(diagnostics) {
        const uniqueDiagnostics = deduplicateDiagnostics(diagnostics);

        super(formatMessage(uniqueDiagnostics));

        this.diagnostics = [ ...diagnostics ];

        Object.defineProperties(this, {
            /**
             * Error type for programmatic error handling.
             * @name name
             * @type {string}
             */
            name: {
                enumerable: true,
                value: this.constructor.name,
            },
            /**
             * Stable error code for programmatic error handling.
             * @name code
             * @type {string}
             */
            code: {
                enumerable: true,
                value: this.constructor.name,
            },
        });
    }
}

function deduplicateDiagnostics(diagnostics) {
    const seen = new Set();

    return diagnostics.filter((diagnostic) => {
        const identity = JSON.stringify(diagnostic);

        if (seen.has(identity)) {
            return false;
        }

        seen.add(identity);
        return true;
    });
}

function formatMessage(diagnostics) {
    const heading = `Bundle failed with ${ diagnostics.length } diagnostic${ diagnostics.length === 1 ? '' : 's' }`;
    const details = diagnostics.map(formatDiagnostic);

    return [ heading, ...details ].join('\n');
}

function formatDiagnostic(diagnostic) {
    const location = `${ diagnostic.importer ?? 'entry' }:${ diagnostic.line }:${ diagnostic.column }`;
    const specifier = diagnostic.specifier ? ` import "${ diagnostic.specifier }"` : '';

    return `- ${ location }${ specifier }: ${ diagnostic.message }`;
}
