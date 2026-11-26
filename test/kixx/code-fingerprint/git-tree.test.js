import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { computeCodeFingerprint, parseGitLsTree } from '../../../kixx/code-fingerprint/mod.js';
import {
    CONTENT_ROOTS,
    GOLDEN_BLOBS,
    GOLDEN_TREE,
    SHA1_FINGERPRINT,
    SHA1_OIDS,
    makeGoldenEntries,
} from './code-fingerprint-goldens.js';


const execFileAsync = promisify(execFile);


function sortByPath(entries) {
    return entries.slice().sort((a, b) => {
        if (a.path === b.path) {
            return 0;
        }
        return a.path < b.path ? -1 : 1;
    });
}

// The golden tree is built from blobs and index entries alone: no working
// tree and no commit, so no identity, signing, or line ending setting
// matters. git never reads the user's or the system's configuration.
describe('code fingerprint of a real git tree', ({ before, after, it }) => {
    let directory;
    let listing;
    let blobIds;

    before(async () => {
        directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-code-fingerprint-'));

        const repository = path.join(directory, 'repository');
        const globalConfig = path.join(directory, 'gitconfig');
        await fsp.writeFile(globalConfig, '');

        const env = {};
        for (const [ key, value ] of Object.entries(process.env)) {
            if (!key.startsWith('GIT_')) {
                env[key] = value;
            }
        }
        Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, HOME: directory });

        async function git(args) {
            try {
                const { stdout } = await execFileAsync('git', args, { env, encoding: 'buffer', maxBuffer: 1024 * 1024 });
                return stdout;
            } catch (cause) {
                if (cause.code === 'ENOENT') {
                    throw new Error('This test needs git on PATH (a development prerequisite)', { cause });
                }
                throw cause;
            }
        }

        await git([ 'init', '-q', '--object-format=sha1', repository ]);

        const blobNames = Object.keys(GOLDEN_BLOBS);
        const blobFiles = [];
        for (const name of blobNames) {
            const file = path.join(directory, `blob-${ name }`);
            await fsp.writeFile(file, GOLDEN_BLOBS[name]);
            blobFiles.push(file);
        }

        const hashed = (await git([ '-C', repository, 'hash-object', '-w', '--no-filters', ...blobFiles ])).toString().trim().split('\n');
        blobIds = Object.fromEntries(blobNames.map((name, i) => [ name, hashed[i] ]));

        const cacheinfo = [];
        for (const [ mode, blob, entryPath ] of GOLDEN_TREE) {
            cacheinfo.push('--cacheinfo', `${ mode },${ SHA1_OIDS[blob] },${ entryPath }`);
        }
        await git([ '-C', repository, 'update-index', '--add', ...cacheinfo ]);

        const tree = (await git([ '-C', repository, 'write-tree' ])).toString().trim();
        listing = await git([ '-C', repository, 'ls-tree', '-r', '-z', tree ]);
    });

    after(async () => {
        if (directory) {
            await fsp.rm(directory, { recursive: true, force: true });
        }
    });

    it('stores each golden blob under its golden id', () => {
        for (const [ name, oid ] of Object.entries(blobIds)) {
            assertEqual(SHA1_OIDS[name], oid, name);
        }
    });

    it('parses exactly the golden entries', () => {
        const parsed = sortByPath(parseGitLsTree(listing));
        const expected = sortByPath(makeGoldenEntries(SHA1_OIDS));

        assertEqual(JSON.stringify(expected), JSON.stringify(parsed));
    });

    it('computes the golden fingerprint from the parsed listing', async () => {
        const entries = parseGitLsTree(listing);
        assertEqual(SHA1_FINGERPRINT, await computeCodeFingerprint({ entries, contentRoots: CONTENT_ROOTS }));
    });
});
