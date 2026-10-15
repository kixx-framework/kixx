import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Filesystem operations shared by the bundler and the Cloudflare worker
 * version pipeline. Implementations decode source as UTF-8, resolve real
 * paths, and treat absent or non-file paths as false.
 *
 * @typedef {Object} FileSystem
 * @property {(filepath: string) => Promise<string>} readFile - Reads UTF-8 source text.
 * @property {(filepath: string) => Promise<ArrayBuffer>} readBinaryFile - Reads exact file bytes.
 * @property {(directory: string) => Promise<import('node:fs').Dirent[]>} readDirectory - Reads directory entries with type information.
 * @property {(filepath: string) => Promise<import('node:fs').Stats>} lstat - Reads metadata without following symbolic links.
 * @property {(filepath: string) => Promise<import('node:fs').Stats>} stat - Reads filesystem metadata.
 * @property {(filepath: string, contents: string) => Promise<void>} writeFile - Writes UTF-8 text, creating the parent directory.
 * @property {(filepath: string) => Promise<string>} realpath - Resolves symlinks and on-disk casing.
 * @property {(filepath: string) => Promise<boolean>} isFile - Reports whether filepath names a file.
 */

const fileSystem = Object.freeze({
    async readFile(filepath) {
        return fsp.readFile(filepath, 'utf8');
    },
    async readBinaryFile(filepath) {
        const bytes = await fsp.readFile(filepath);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    async readDirectory(directory) {
        return fsp.readdir(directory, { withFileTypes: true });
    },
    async lstat(filepath) {
        return fsp.lstat(filepath);
    },
    async stat(filepath) {
        return fsp.stat(filepath);
    },
    async writeFile(filepath, contents) {
        await fsp.mkdir(path.dirname(filepath), { recursive: true });
        await fsp.writeFile(filepath, contents, 'utf8');
    },
    async realpath(filepath) {
        return fsp.realpath(filepath);
    },
    async isFile(filepath) {
        try {
            const stats = await fsp.stat(filepath);
            return stats.isFile();
        } catch (cause) {
            if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') {
                return false;
            }

            throw cause;
        }
    },
});

export default fileSystem;
