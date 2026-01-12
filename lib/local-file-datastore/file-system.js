import fsp from 'node:fs/promises';


export function readDirectory(dirpath) {
    return fsp.readdir(dirpath, { recursive: false, withFileTypes: true });
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
