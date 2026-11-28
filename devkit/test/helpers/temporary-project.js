import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';


/**
 * Creates an empty temporary directory, calls the function with its real
 * path, and removes it afterwards, whether or not the function throws.
 *
 * @param {function(string): Promise<*>} fn
 * @returns {Promise<*>} What the function resolved
 */
export async function withTemporaryDirectory(fn) {
    // The real path, so it equals what the code under test resolves on a
    // system whose temporary directory is a symbolic link.
    const directory = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-dev-test-')));

    try {
        return await fn(directory);
    } finally {
        await fsp.rm(directory, { recursive: true, force: true });
    }
}

/**
 * Makes a directory look like a Kixx project to the CLI: it writes the
 * `kixx/plugin.json` that project discovery and the version gate read. It
 * holds no code, so a test that needs tooling passes a fake loader.
 *
 * @param {string} directory - Created when it does not exist
 * @param {Object} [options]
 * @param {string} [options.version='7.0.0'] - The manifest's version
 * @param {string} [options.manifestText] - Written as is, in place of a manifest with a version
 * @returns {Promise<string>} The directory
 */
export async function writeProjectMarker(directory, options) {
    const { version = '7.0.0', manifestText } = options ?? {};

    await fsp.mkdir(path.join(directory, 'kixx'), { recursive: true });

    await fsp.writeFile(
        path.join(directory, 'kixx', 'plugin.json'),
        manifestText ?? JSON.stringify({ name: 'kixx', version }),
    );

    return directory;
}
