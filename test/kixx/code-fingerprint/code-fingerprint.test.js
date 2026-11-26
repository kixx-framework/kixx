import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertNotEqual } from 'kixx-assert';

import {
    CODE_FINGERPRINT_FORMAT,
    GIT_FILE_MODES,
    computeCodeFingerprint,
    isValidCodeFingerprint,
    isValidGitObjectId,
    parseGitLsTree,
} from '../../../kixx/code-fingerprint/mod.js';
import {
    CONTENT_ROOTS,
    SHA1_FINGERPRINT,
    SHA1_OIDS,
    makeGoldenEntries,
} from './code-fingerprint-goldens.js';
import * as tooling from '../../../kixx/tooling/mod.js';


function fingerprint(entries) {
    return computeCodeFingerprint({ entries, contentRoots: CONTENT_ROOTS });
}

function replaceEntry(path, changes) {
    return makeGoldenEntries(SHA1_OIDS).map((entry) => {
        return entry.path === path ? Object.assign({}, entry, changes) : entry;
    });
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}


describe('computeCodeFingerprint', ({ describe, it }) => {

    it('is format 1 over the four git file modes', () => {
        assertEqual(1, CODE_FINGERPRINT_FORMAT);
        assertEqual('100644,100755,120000,160000', GIT_FILE_MODES.join(','));
    });

    describe('code changes', ({ it }) => {
        it('changes when a code entry changes its mode', async () => {
            assertNotEqual(SHA1_FINGERPRINT, await fingerprint(replaceEntry('app/app.js', { mode: '100755' })));
            assertNotEqual(SHA1_FINGERPRINT, await fingerprint(replaceEntry('current', { mode: '100644' })));
        });

        it('changes when a code entry changes its oid', async () => {
            assertNotEqual(SHA1_FINGERPRINT, await fingerprint(replaceEntry('app/app.js', { oid: SHA1_OIDS.hello })));
        });

        it('changes when a code entry changes its path', async () => {
            assertNotEqual(SHA1_FINGERPRINT, await fingerprint(replaceEntry('app/app.js', { path: 'app/main.js' })));
        });

        it('changes when a code entry is added or removed', async () => {
            const entries = makeGoldenEntries(SHA1_OIDS);

            const added = entries.concat({ path: 'routes/site.jsonc', mode: '100644', oid: SHA1_OIDS.empty });
            const removed = entries.filter((entry) => entry.path !== 'bin/run.sh');

            assertNotEqual(SHA1_FINGERPRINT, await fingerprint(added));
            assertNotEqual(SHA1_FINGERPRINT, await fingerprint(removed));
        });

        it('changes when a CI workflow or the agents lockfile changes (D40)', async () => {
            assertNotEqual(SHA1_FINGERPRINT, await fingerprint(replaceEntry('.github/workflows/ci.yml', { oid: SHA1_OIDS.empty })));
            assertNotEqual(SHA1_FINGERPRINT, await fingerprint(replaceEntry('kixx.lock.json', { oid: SHA1_OIDS.hello })));
        });
    });

    describe('changes outside code', ({ it }) => {
        it('ignores changing a content, agent, test, or docs entry', async () => {
            const paths = [
                'pages/page.json',
                'plugins/visits/pages/p/page.json',
                'AGENTS.md',
                'test/app.test.js',
                'README.md',
                'docs/guide.html',
            ];

            for (const path of paths) {
                assertEqual(SHA1_FINGERPRINT, await fingerprint(replaceEntry(path, { oid: SHA1_OIDS.empty, mode: '100755' })), path);
            }
        });

        it('ignores adding or removing a content, agent, test, or docs entry', async () => {
            const entries = makeGoldenEntries(SHA1_OIDS);

            const added = entries.concat([
                { path: 'templates/base.html', mode: '100644', oid: SHA1_OIDS.hello },
                { path: '.claude/settings.json', mode: '100644', oid: SHA1_OIDS.hello },
                { path: 'test/other.test.js', mode: '100644', oid: SHA1_OIDS.hello },
                { path: 'kixx/hyperview/README.md', mode: '100644', oid: SHA1_OIDS.hello },
            ]);
            const removed = entries.filter((entry) => entry.path !== 'pages/page.json' && entry.path !== 'README.md');

            assertEqual(SHA1_FINGERPRINT, await fingerprint(added));
            assertEqual(SHA1_FINGERPRINT, await fingerprint(removed));
        });

        it('counts a plugin content root as code when the plugin is not installed', async () => {
            const entries = makeGoldenEntries(SHA1_OIDS);
            assertNotEqual(SHA1_FINGERPRINT, await computeCodeFingerprint({ entries }));
        });
    });

    describe('invalid input', ({ it }) => {
        it('refuses entries that are not an array', async () => {
            const error = await catchRejection(computeCodeFingerprint({ entries: {} }));
            assertEqual('AssertionError', error?.name);
        });

        it('refuses an entry that is not a plain object, naming its index', async () => {
            const error = await catchRejection(computeCodeFingerprint({ entries: [ 'app/app.js' ] }));
            assertEqual('AssertionError', error?.name);
            assert(error.message.includes('entry 0'));
        });

        it('refuses a tree type mode', async () => {
            const error = await catchRejection(fingerprint(replaceEntry('app/app.js', { mode: '40000' })));
            assertEqual('AssertionError', error?.name);
            assert(error.message.includes('app/app.js'));
        });
    });
});

describe('code fingerprint tooling exports', ({ it }) => {
    it('re-exports the fingerprint, its predicates, and the parser', () => {
        assertEqual(CODE_FINGERPRINT_FORMAT, tooling.CODE_FINGERPRINT_FORMAT);
        assertEqual(computeCodeFingerprint, tooling.computeCodeFingerprint);
        assertEqual(isValidCodeFingerprint, tooling.isValidCodeFingerprint);
        assertEqual(isValidGitObjectId, tooling.isValidGitObjectId);
        assertEqual(parseGitLsTree, tooling.parseGitLsTree);
    });
});

describe('isValidGitObjectId', ({ it }) => {
    it('accepts 40 and 64 lowercase hex characters only', () => {
        assert(isValidGitObjectId('a'.repeat(40)));
        assert(isValidGitObjectId('0123456789abcdef'.repeat(4)));
        assertFalsy(isValidGitObjectId('A'.repeat(40)));
        assertFalsy(isValidGitObjectId('a'.repeat(39)));
        assertFalsy(isValidGitObjectId('a'.repeat(41)));
        assertFalsy(isValidGitObjectId('g'.repeat(40)));
        assertFalsy(isValidGitObjectId(null));
    });
});

describe('isValidCodeFingerprint', ({ it }) => {
    it('accepts any format version with 64 lowercase hex characters', () => {
        assert(isValidCodeFingerprint(SHA1_FINGERPRINT));
        assert(isValidCodeFingerprint(`kxfp12:${ 'a'.repeat(64) }`));
        assertFalsy(isValidCodeFingerprint(`kxfp0:${ 'a'.repeat(64) }`));
        assertFalsy(isValidCodeFingerprint(`kxfp:${ 'a'.repeat(64) }`));
        assertFalsy(isValidCodeFingerprint(`kxfp1:${ 'A'.repeat(64) }`));
        assertFalsy(isValidCodeFingerprint(`kxfp1:${ 'a'.repeat(63) }`));
        assertFalsy(isValidCodeFingerprint('a'.repeat(64)));
        assertFalsy(isValidCodeFingerprint(undefined));
    });
});
