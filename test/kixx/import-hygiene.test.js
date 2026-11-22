// Core is vendored as-is into projects (R1, CORE-1), so it must be
// self-contained: relative imports stay inside kixx/, platform modules
// appear only in adapters, and nothing imports a module that is leaving
// core except the known edges below.
//
// When a section extracts a module or removes an edge, delete its entry
// from LEAVING_CORE or KNOWN_EDGES. Rule 4 fails until you do.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';


const CORE_DIRECTORY = fileURLToPath(new URL('../../kixx/', import.meta.url));

// Modules still in core that a later section removes.
const LEAVING_CORE = {
    'document-store': 'S25',
    'jobs': 'S28',
    'object-store': 'S27',
    'permissions': 'S29',
};

// Imports from the rest of core into a module in LEAVING_CORE, as
// core-relative paths.
const KNOWN_EDGES = [
    { from: 'context/application-context.js', to: 'jobs/job-logger.js', removedBy: 'S28' },
];

// Static import and export specifiers, including multi-line import lists.
// Excluding `(` and `=` keeps it from matching `export function f(…)`,
// `export const x = '…'`, and JSDoc `import('…')` type references.
const SPECIFIER_PATTERN = /^[ \t]*(?:import[ \t]*|(?:import|export)\b[^'";()=]*?\bfrom[ \t]*)(['"])([^'"]+)\1/gm;


export function extractSpecifiers(source) {
    return Array.from(source.matchAll(SPECIFIER_PATTERN), (match) => match[2]);
}


describe('core import hygiene', ({ it }) => {
    const imports = readCoreImports();

    it('extracts only static import and export specifiers', () => {
        const sample = [
            'import {',
            '    a,',
            '    b,',
            "} from './multi-line.js';",
            "export { c } from '../re-export.js';",
            "import './side-effect.js';",
            "export const NAME = 'not-a-specifier';",
            '/**',
            " * @param {import('stream').Readable} stream",
            ' */',
        ].join('\n');

        assertEqual(
            './multi-line.js,../re-export.js,./side-effect.js',
            extractSpecifiers(sample).join(','),
        );
    });

    it('resolves every relative import inside core', () => {
        const violations = imports.filter(({ specifier, target }) => {
            return specifier.startsWith('.') && (!isInsideCore(target) || !fs.existsSync(target));
        });

        assertEqual('', formatViolations(violations));
    });

    it('imports platform modules only in adapters', () => {
        const violations = imports.filter(({ file, specifier }) => {
            if (specifier.startsWith('.')) {
                return false;
            }
            const isPlatform = specifier.startsWith('node:') || specifier.startsWith('cloudflare:');
            return !isPlatform || !file.startsWith('adapters/');
        });

        assertEqual('', formatViolations(violations));
    });

    it('imports modules leaving core only through known edges', () => {
        const violations = imports.filter(({ file, specifier, target }) => {
            if (!specifier.startsWith('.') || leavingModuleOf(file) || !isInsideCore(target)) {
                return false;
            }
            const to = toCorePath(target);
            if (!leavingModuleOf(to)) {
                return false;
            }
            return !KNOWN_EDGES.some((edge) => edge.from === file && edge.to === to);
        });

        assertEqual('', formatViolations(violations));
    });

    it('lists no module or edge that is already gone', () => {
        const stale = [];

        for (const [ name, section ] of Object.entries(LEAVING_CORE)) {
            if (!fs.existsSync(path.join(CORE_DIRECTORY, name))) {
                stale.push(`LEAVING_CORE['${ name }'] is gone; ${ section } must delete the entry`);
            }
        }

        for (const edge of KNOWN_EDGES) {
            const exists = imports.some(({ file, target }) => {
                return file === edge.from && isInsideCore(target) && toCorePath(target) === edge.to;
            });
            if (!exists) {
                stale.push(`KNOWN_EDGES ${ edge.from } -> ${ edge.to } is gone; ${ edge.removedBy } must delete the entry`);
            }
        }

        assertEqual('', stale.join('\n'));
    });
});


// Returns one record per specifier in every .js file under core, vendor/
// included: vendored code ships too.
function readCoreImports() {
    const files = fs.readdirSync(CORE_DIRECTORY, { recursive: true })
        .map((name) => name.split(path.sep).join('/'))
        .filter((name) => name.endsWith('.js'))
        .sort();

    return files.flatMap((file) => {
        const filepath = path.join(CORE_DIRECTORY, file);
        const source = fs.readFileSync(filepath, 'utf8');

        return extractSpecifiers(source).map((specifier) => {
            const target = specifier.startsWith('.')
                ? path.resolve(path.dirname(filepath), specifier)
                : null;
            return { file, specifier, target };
        });
    });
}

function isInsideCore(filepath) {
    const relativePath = path.relative(CORE_DIRECTORY, filepath);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function toCorePath(filepath) {
    return path.relative(CORE_DIRECTORY, filepath).split(path.sep).join('/');
}

function leavingModuleOf(corePath) {
    const name = corePath.split('/')[0];
    return Object.hasOwn(LEAVING_CORE, name) ? name : null;
}

function formatViolations(violations) {
    return violations.map(({ file, specifier }) => `${ file } -> ${ specifier }`).join('\n');
}
