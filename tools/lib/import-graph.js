// Reads the static imports of JavaScript files without loading them. The
// import hygiene test (test/kixx/import-hygiene.test.js) and the project
// assembly (tools/lib/assemble-project.js) share it, so there is one
// specifier parser.
import fs from 'node:fs';
import path from 'node:path';


// Static import and export specifiers, including multi-line import lists.
// Excluding `(` and `=` keeps it from matching `export function f(…)`,
// `export const x = '…'`, and JSDoc `import('…')` type references.
const SPECIFIER_PATTERN = /^[ \t]*(?:import[ \t]*|(?:import|export)\b[^'";()=]*?\bfrom[ \t]*)(['"])([^'"]+)\1/gm;


export function extractSpecifiers(source) {
    return Array.from(source.matchAll(SPECIFIER_PATTERN), (match) => match[2]);
}

// Follows static relative specifiers from the entry files (absolute paths)
// to every file they reach, reading each file once. Returns one record per
// reached file: its path, its specifiers, and the chain of files that led to
// it, starting at an entry file.
//
// A dynamic import() isn't followed, because SPECIFIER_PATTERN doesn't
// match one.
//
// A file that `stopAt` accepts is recorded but never read, so its imports
// aren't followed: it may import a file that doesn't exist here.
//
// `resolve` turns a relative specifier into an absolute path. The default
// resolves it against the importing file's directory.
export function readImportGraph(entryFiles, stopAt = () => false, resolve = resolveSpecifier) {
    const graph = new Map();
    const queue = entryFiles.map((filepath) => [ filepath ]);

    while (queue.length > 0) {
        const chain = queue.shift();
        const file = chain.at(-1);

        if (graph.has(file)) {
            continue;
        }

        const specifiers = stopAt(file) ? [] : extractSpecifiers(fs.readFileSync(file, 'utf8'));
        graph.set(file, { file, specifiers, chain });

        for (const specifier of specifiers) {
            if (specifier.startsWith('.')) {
                queue.push([ ...chain, resolve(file, specifier) ]);
            }
        }
    }

    return Array.from(graph.values());
}

function resolveSpecifier(file, specifier) {
    return path.resolve(path.dirname(file), specifier);
}
