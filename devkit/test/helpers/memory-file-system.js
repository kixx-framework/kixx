/**
 * Creates an in-memory stand-in for `lib/file-system.js` holding text files.
 * Reads of an unknown path reject with an `ENOENT` error, like the real one.
 * Only text reads and writes are supported; add methods as tests need them.
 * @param {Object<string, string>} [files] - Absolute filepath to file contents
 * @returns {{ files: Map<string, string>, readFile: Function, writeFile: Function, isFile: Function }}
 */
export default function createMemoryFileSystem(files) {
    const contents = new Map(Object.entries(files ?? {}));

    return {
        files: contents,
        async readFile(filepath) {
            if (!contents.has(filepath)) {
                const error = new Error(`ENOENT: no such file or directory, open '${ filepath }'`);
                error.code = 'ENOENT';
                throw error;
            }
            return contents.get(filepath);
        },
        async writeFile(filepath, text) {
            contents.set(filepath, text);
        },
        async isFile(filepath) {
            return contents.has(filepath);
        },
    };
}
