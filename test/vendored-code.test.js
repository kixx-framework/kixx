import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertNotEqual } from 'kixx-assert';


const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const RECORD_PATH = path.join(REPO_ROOT, 'vendored-code.json');
const PROCEDURE = 'See docs/vendored-code.md.';

// Vendored directories outside a vendor root. Every immediate subdirectory
// of a vendor root is vendored code too.
const FIXED_PATHS = [ 'kixx/errors', 'kixx/assertions' ];
const VENDOR_ROOTS = [ 'kixx/vendor', 'devkit/lib/vendor' ];

const REQUIRED_FIELDS = [ 'path', 'name', 'version', 'source', 'files' ];

// Finder litter on macOS; never part of a vendored copy.
const IGNORED_FILE_NAME = '.DS_Store';


// Read at load time so each entry gets its own named test.
const { record, recordError } = readRecord();
const entries = Array.isArray(record?.entries) ? record.entries : [];


describe('vendored-code.json', ({ it, describe }) => { // eslint-disable-line no-shadow

    it('parses with a non-empty entries array', () => {
        assertEqual(null, recordError, `vendored-code.json could not be read: ${ recordError?.message }`);
        assert(Array.isArray(record.entries), 'vendored-code.json needs an "entries" array');
        assert(entries.length > 0, 'vendored-code.json has no entries');
    });

    it('gives every entry the required fields', () => {
        for (const entry of entries) {
            const label = entry?.path || JSON.stringify(entry);

            for (const field of REQUIRED_FIELDS) {
                assert(isNonEmptyString(entry[field]), `${ label }: "${ field }" must be a non-empty string`);
            }

            assertMatches(/^[0-9a-f]{64}$/, entry.sha256, `${ label }: "sha256" must be 64 lowercase hex characters`);

            if ('deviation' in entry) {
                assert(isNonEmptyString(entry.deviation), `${ label }: "deviation", when present, must be a non-empty string`);
            }
        }
    });

    it('has unique paths', () => {
        const seen = new Set();

        for (const entry of entries) {
            assert(!seen.has(entry.path), `${ entry.path }: listed more than once`);
            seen.add(entry.path);
        }
    });

    it('has an entry for every vendored directory and a directory for every entry', async () => {
        const recorded = new Set(entries.map(entry => entry.path));
        const present = await listVendoredDirectories();

        for (const dirpath of present) {
            assert(recorded.has(dirpath), `${ dirpath } is vendored code with no entry in vendored-code.json. ${ PROCEDURE }`);
        }

        for (const dirpath of recorded) {
            assert(present.includes(dirpath), `vendored-code.json lists ${ dirpath }, but it is not a vendored directory. ${ PROCEDURE }`);
        }
    });

    // eslint-disable-next-line no-shadow
    describe('digests', ({ it }) => {
        for (const entry of entries) {
            it(entry.path, async () => {
                const actual = await digestDirectory(path.join(REPO_ROOT, entry.path));

                assertEqual(
                    entry.sha256,
                    actual,
                    `${ entry.path }: files changed. Recorded sha256 ${ entry.sha256 }, actual ${ actual }. ${ PROCEDURE }`,
                );
            });
        }
    });
});


describe('digestDirectory', ({ before, after, it }) => {
    let tmpRoot;

    before(async () => {
        tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-vendored-code-'));
    });

    after(async () => {
        await fsp.rm(tmpRoot, { recursive: true, force: true });
    });

    async function makeTree(name, files) {
        const root = path.join(tmpRoot, name);

        for (const [ relativePath, contents ] of files) {
            const filepath = path.join(root, relativePath);
            await fsp.mkdir(path.dirname(filepath), { recursive: true });
            await fsp.writeFile(filepath, contents);
        }

        return root;
    }

    const BASE_FILES = [
        [ 'mod.js', 'export default 1;\n' ],
        [ 'lib/a.js', 'a\n' ],
        [ 'lib/b.js', 'b\n' ],
    ];

    it('gives the same digest regardless of creation order', async () => {
        const forward = await makeTree('forward', BASE_FILES);
        const reverse = await makeTree('reverse', BASE_FILES.slice().reverse());

        assertEqual(await digestDirectory(forward), await digestDirectory(reverse));
    });

    it('changes when one byte changes', async () => {
        const base = await makeTree('byte-base', BASE_FILES);
        const changed = await makeTree('byte-changed', [ ...BASE_FILES.slice(0, 2), [ 'lib/b.js', 'c\n' ] ]);

        assertNotEqual(await digestDirectory(base), await digestDirectory(changed));
    });

    it('changes when a file is renamed', async () => {
        const base = await makeTree('rename-base', BASE_FILES);
        const renamed = await makeTree('rename-changed', [ ...BASE_FILES.slice(0, 2), [ 'lib/c.js', 'b\n' ] ]);

        assertNotEqual(await digestDirectory(base), await digestDirectory(renamed));
    });

    it('changes when a file is added', async () => {
        const base = await makeTree('add-base', BASE_FILES);
        const added = await makeTree('add-changed', [ ...BASE_FILES, [ 'extra.txt', 'x' ] ]);

        assertNotEqual(await digestDirectory(base), await digestDirectory(added));
    });

    it('changes when a file is removed', async () => {
        const base = await makeTree('remove-base', BASE_FILES);
        const removed = await makeTree('remove-changed', BASE_FILES.slice(0, 2));

        assertNotEqual(await digestDirectory(base), await digestDirectory(removed));
    });

    it('ignores .DS_Store files', async () => {
        const base = await makeTree('ds-base', BASE_FILES);
        const littered = await makeTree('ds-changed', [ ...BASE_FILES, [ '.DS_Store', 'x' ], [ 'lib/.DS_Store', 'y' ] ]);

        assertEqual(await digestDirectory(base), await digestDirectory(littered));
    });

    it('fails on a symlink', async () => {
        const root = await makeTree('symlink', BASE_FILES);
        await fsp.symlink(path.join(root, 'mod.js'), path.join(root, 'link.js'));

        const error = await catchAsyncError(() => digestDirectory(root));

        assert(error, 'expected digestDirectory to reject');
        assertMatches('link.js', error.message);
    });
});


/**
 * Computes the digest of a vendored directory: SHA-256 over sorted
 * `<relativePath>\0<sha256 of file bytes>\n` lines, one per regular file.
 * @param {string} dirpath - Absolute directory path
 * @returns {Promise<string>} Lowercase hex digest
 */
async function digestDirectory(dirpath) {
    const relativePaths = await listFiles(dirpath, '');

    // Default string sort, so the order is the same on every runtime.
    relativePaths.sort();

    const hash = createHash('sha256');

    for (const relativePath of relativePaths) {
        const bytes = await fsp.readFile(path.join(dirpath, ...relativePath.split('/')));
        const fileHash = createHash('sha256').update(bytes).digest('hex');
        hash.update(`${ relativePath }\0${ fileHash }\n`, 'utf8');
    }

    return hash.digest('hex');
}

async function listFiles(rootpath, prefix) {
    const dirents = await fsp.readdir(path.join(rootpath, ...prefix.split('/')), { withFileTypes: true });
    const files = [];

    for (const dirent of dirents) {
        const relativePath = prefix ? `${ prefix }/${ dirent.name }` : dirent.name;

        if (dirent.isDirectory()) {
            files.push(...await listFiles(rootpath, relativePath));
        } else if (dirent.isFile()) {
            if (dirent.name !== IGNORED_FILE_NAME) {
                files.push(relativePath);
            }
        } else {
            throw new Error(`Vendored code must hold only regular files and directories: ${ relativePath }`);
        }
    }

    return files;
}

async function listVendoredDirectories() {
    const dirpaths = FIXED_PATHS.slice();

    for (const vendorRoot of VENDOR_ROOTS) {
        const dirents = await fsp.readdir(path.join(REPO_ROOT, vendorRoot), { withFileTypes: true });

        for (const dirent of dirents) {
            if (dirent.isDirectory()) {
                dirpaths.push(`${ vendorRoot }/${ dirent.name }`);
            } else if (dirent.name !== IGNORED_FILE_NAME) {
                throw new Error(`${ vendorRoot }/${ dirent.name } is not a directory. A vendor root holds only vendored directories. ${ PROCEDURE }`);
            }
        }
    }

    return dirpaths;
}

function readRecord() {
    try {
        return { record: JSON.parse(fs.readFileSync(RECORD_PATH, 'utf8')), recordError: null };
    } catch (error) {
        return { record: null, recordError: error };
    }
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }

    return null;
}
