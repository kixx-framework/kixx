import fsp from 'node:fs/promises';


export function readDirectory(dirpath) {
    // withFileTypes: true returns Dirent objects instead of strings, which include
    // isFile() and isDirectory() methods. This avoids additional stat() calls in
    // the caller to determine file types.
    try {
        return fsp.readdir(dirpath, { recursive: false, withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

export function writeDocumentFile(filepath, document) {
    const json = JSON.stringify(document);
    return fsp.writeFile(filepath, json, { encoding: 'utf8' });
}

export async function readDocumentFile(filepath) {
    let json;

    try {
        json = await fsp.readFile(filepath, { encoding: 'utf8' });
    } catch (error) {
        // Return null for missing files rather than throwing, which allows callers
        // to distinguish "not found" (null) from actual errors (thrown). This pattern
        // simplifies code that checks if a document exists before operating on it
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }

    return JSON.parse(json);
}

export function removeDocumentFile(filepath) {
    // force: true makes this operation idempotent - if the file doesn't exist, it succeeds
    // silently rather than throwing ENOENT. This allows callers to use removeFile as an
    // "ensure deleted" operation without checking existence first
    return fsp.rm(filepath, { force: true });
}
