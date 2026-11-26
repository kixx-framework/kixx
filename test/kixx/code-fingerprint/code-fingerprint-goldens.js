import { assert, assertEqual } from '../../../kixx/assertions/mod.js';


// Golden vectors for the code fingerprint, format 1. Any implementation that
// feeds or computes the fingerprint (the CLI from `git ls-tree`, Studio from
// its workspace's git objects) runs this suite and must pass it unchanged.
//
// How the expected values were produced, independently of the function under
// test (2026-11-25):
//
// - SHA-1 blob ids: `git hash-object --stdin` (git 2.43.0) over each blob's
//   bytes. The empty blob and `hello\n` are the well-known ids.
// - SHA-256 blob ids: SHA-256 over `blob <length>\0<bytes>` (git's SHA-256
//   object id formula) with Python's hashlib. The gitlink ids are synthetic:
//   any commit id works, since only the fingerprint's hashing of it matters.
// - Fingerprints: Python's hashlib SHA-256 over the serialization written out
//   below, prefixed `kxfp1:`. The header-only value was also checked with
//   `printf 'kixx code fingerprint 1\n' | sha256sum`.
//
// A value here changes only with a new format version. Don't regenerate one
// to make a failing test pass.

export const CONTENT_ROOTS = Object.freeze([
    Object.freeze({ plugin: 'visits', pagesDirectory: 'plugins/visits/pages' }),
]);

// The bytes of each blob in the tree below.
export const GOLDEN_BLOBS = Object.freeze({
    empty: '',
    hello: 'hello\n',
    module: 'export default {};\n',
    script: '#!/bin/sh\necho hi\n',
    link: 'app/app.js',
});

export const SHA1_OIDS = Object.freeze({
    empty: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
    hello: 'ce013625030ba8dba906f756967f9e9ca394464a',
    module: 'ff8b4c56321a3362fc00224b01800f62466f9a1f',
    script: '4163036efa65bd4a469e752267498f01ea36a55c',
    link: '43207e355e463499468d756d158c4b1cc159393a',
    gitlink: '0123456789abcdef0123456789abcdef01234567',
});

export const SHA256_OIDS = Object.freeze({
    empty: '473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813',
    hello: '2cf8d83d9ee29543b34a87727421fdecb7e3f3a183d337639025de576db9ebb4',
    module: '4bb3920168c60c429dcf48b9faa2d69718592a6c04ff7ec018c62d692f5adb2a',
    script: '55832c1f0df1086af83cc3c15359e9537e7dd5c52fbe1a772a3d96583b04d2dd',
    link: '65ad3f7f6395484901e4914710649c8e6e8dd3c1c789231476ac0dcc19969346',
    gitlink: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
});

// [ mode, blob, path ]. Every mode, one gitlink, non-ASCII paths, and six
// excluded paths. `a.b` sorts before `a/b`, so a walk that visits directory
// `a` before its sibling `a.b` gets the order wrong. `app/Ａ.js` sorts
// before `app/\u{1F600}.js` by UTF-8 bytes but after it by UTF-16 code units,
// so JavaScript's default string order gets it wrong.
export const GOLDEN_TREE = Object.freeze([
    [ '100644', 'module', 'app/app.js' ],
    [ '100755', 'script', 'bin/run.sh' ],
    [ '120000', 'link', 'current' ],
    [ '160000', 'gitlink', 'vendor/lib' ],
    [ '100644', 'empty', 'a.b' ],
    [ '100644', 'hello', 'a/b' ],
    [ '100644', 'module', 'app/été.js' ],
    [ '100644', 'module', 'app/Ａ.js' ],
    [ '100644', 'hello', 'app/\u{1F600}.js' ],
    [ '100644', 'hello', '.github/workflows/ci.yml' ],
    [ '100644', 'empty', 'kixx.lock.json' ],
    [ '100644', 'hello', 'pages/page.json' ],
    [ '100644', 'hello', 'plugins/visits/pages/p/page.json' ],
    [ '100644', 'hello', 'README.md' ],
    [ '100644', 'hello', 'AGENTS.md' ],
    [ '100644', 'hello', 'test/app.test.js' ],
    [ '100644', 'hello', 'docs/guide.html' ],
].map(Object.freeze));

// The exact text hashed for the SHA-1 tree: the header, then the code
// entries in UTF-8 byte order of the path.
export const SHA1_SERIALIZATION = 'kixx code fingerprint 1\n'
    + '100644 ce013625030ba8dba906f756967f9e9ca394464a\t.github/workflows/ci.yml\0'
    + '100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\ta.b\0'
    + '100644 ce013625030ba8dba906f756967f9e9ca394464a\ta/b\0'
    + '100644 ff8b4c56321a3362fc00224b01800f62466f9a1f\tapp/app.js\0'
    + '100644 ff8b4c56321a3362fc00224b01800f62466f9a1f\tapp/été.js\0'
    + '100644 ff8b4c56321a3362fc00224b01800f62466f9a1f\tapp/Ａ.js\0'
    + '100644 ce013625030ba8dba906f756967f9e9ca394464a\tapp/\u{1F600}.js\0'
    + '100755 4163036efa65bd4a469e752267498f01ea36a55c\tbin/run.sh\0'
    + '120000 43207e355e463499468d756d158c4b1cc159393a\tcurrent\0'
    + '100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\tkixx.lock.json\0'
    + '160000 0123456789abcdef0123456789abcdef01234567\tvendor/lib\0';

export const SHA1_FINGERPRINT = 'kxfp1:0d3b0f2732c78e40cad4a89b85a35d37be2458aa5565454516e1bdefb526c5aa';

export const SHA256_FINGERPRINT = 'kxfp1:19f02536fd1d82bc25fa59330697fe3717ffafba7a1c9d8af185a015fbd98b41';

// No code entries: the header alone.
export const EMPTY_FINGERPRINT = 'kxfp1:2f1be9249aa4c911443314618a90dd1d3fb059b31829056b7fabdbfc6f588136';

// [ path, class ], with CONTENT_ROOTS installed. One or more per row of the
// classification table, and each precedence edge.
const CLASSIFICATION_VECTOR = [
    [ 'pages/page.json', 'content' ],
    [ 'pages/README.md', 'content' ],
    [ 'pages/AGENTS.md', 'content' ],
    [ 'templates/base/default.html', 'content' ],
    [ 'static-assets/stylesheets/site.css', 'content' ],
    [ 'public/favicon.ico', 'content' ],
    [ 'plugins/visits/pages/x/page.json', 'content' ],
    [ 'plugins/visits/pages/README.md', 'content' ],
    [ 'pagesx/a.js', 'code' ],
    [ 'AGENTS.md', 'agent' ],
    [ 'CLAUDE.md', 'agent' ],
    [ 'app/AGENTS.md', 'agent' ],
    [ '.agents/skills/x/SKILL.md', 'agent' ],
    [ '.claude/settings.json', 'agent' ],
    [ '.codex/config.toml', 'agent' ],
    [ 'kixx/agents/x/SKILL.md', 'agent' ],
    [ 'plugins/visits/agents/skill/SKILL.md', 'agent' ],
    [ 'test/fixtures/page.json', 'test' ],
    [ 'test/README.md', 'test' ],
    [ 'docs/guide.html', 'docs' ],
    [ 'README.md', 'docs' ],
    [ 'CHANGELOG.md', 'docs' ],
    [ 'kixx/hyperview/README.md', 'docs' ],
    [ 'plugins/visits/README.md', 'docs' ],
    [ 'app/NOTES.MD', 'docs' ],
    [ 'LICENSE', 'docs' ],
    [ 'LICENSE.txt', 'docs' ],
    [ 'LICENCE', 'docs' ],
    [ 'plugins/visits/adapters/node/x.js', 'code' ],
    [ 'plugins/visits/plugin.json', 'code' ],
    [ 'kixx/plugin.json', 'code' ],
    [ 'app/app.json', 'code' ],
    [ 'routes/site.jsonc', 'code' ],
    [ 'virtual-hosts.js', 'code' ],
    [ 'node-registry.generated.js', 'code' ],
    [ 'node-config.jsonc', 'code' ],
    [ 'package.json', 'code' ],
    [ 'deno.json', 'code' ],
    [ '.env.production', 'code' ],
    [ 'example.env.secrets', 'code' ],
    [ '.github/workflows/ci.yml', 'code' ],
    [ 'kixx.lock.json', 'code' ],
    [ 'package-lock.json', 'code' ],
    [ 'deno.lock', 'code' ],
    [ '.gitignore', 'code' ],
    [ '.kixx/state.json', 'code' ],
    [ 'eslint.config.js', 'code' ],
];


/**
 * Builds the golden tree's entries with one set of object ids.
 * @param {Object<string, string>} oids - SHA1_OIDS or SHA256_OIDS
 * @returns {Array<{path: string, mode: string, oid: string}>}
 */
export function makeGoldenEntries(oids) {
    return GOLDEN_TREE.map(([ mode, blob, path ]) => ({ path, mode, oid: oids[blob] }));
}

async function sha256HexOf(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}


/**
 * @param {Function} group - A describe function
 * @param {function(): {computeCodeFingerprint: Function, classifyPath: Function}} getSubject
 */
export default function codeFingerprintGoldens(group, getSubject) {

    group('classification vector', ({ it }) => {
        it('classifies every golden path', () => {
            const { classifyPath } = getSubject();

            for (const [ path, expected ] of CLASSIFICATION_VECTOR) {
                assertEqual(expected, classifyPath(path, CONTENT_ROOTS), path);
            }
        });
    });

    group('SHA-1 vector', ({ it }) => {
        it('has a serialization that hashes to the golden value', async () => {
            assertEqual(SHA1_FINGERPRINT, `kxfp1:${ await sha256HexOf(SHA1_SERIALIZATION) }`);
        });

        it('computes the golden fingerprint', async () => {
            const { computeCodeFingerprint } = getSubject();
            const entries = makeGoldenEntries(SHA1_OIDS);

            assertEqual(SHA1_FINGERPRINT, await computeCodeFingerprint({ entries, contentRoots: CONTENT_ROOTS }));
        });

        it('gives the same value for entries in any order', async () => {
            const { computeCodeFingerprint } = getSubject();
            const entries = makeGoldenEntries(SHA1_OIDS);

            const reversed = entries.slice().reverse();
            const interleaved = entries.filter((_, i) => i % 2 === 1).concat(entries.filter((_, i) => i % 2 === 0));

            assertEqual(SHA1_FINGERPRINT, await computeCodeFingerprint({ entries: reversed, contentRoots: CONTENT_ROOTS }));
            assertEqual(SHA1_FINGERPRINT, await computeCodeFingerprint({ entries: interleaved, contentRoots: CONTENT_ROOTS }));
        });
    });

    group('SHA-256 vector', ({ it }) => {
        it('computes the golden fingerprint', async () => {
            const { computeCodeFingerprint } = getSubject();
            const entries = makeGoldenEntries(SHA256_OIDS);

            assertEqual(SHA256_FINGERPRINT, await computeCodeFingerprint({ entries, contentRoots: CONTENT_ROOTS }));
        });
    });

    group('empty code set', ({ it }) => {
        it('hashes the header alone when no entry is code', async () => {
            const { computeCodeFingerprint } = getSubject();
            const entries = makeGoldenEntries(SHA1_OIDS).filter((entry) => {
                return [ 'pages/', 'test/', 'docs/', 'plugins/visits/pages/' ].some((prefix) => entry.path.startsWith(prefix));
            });

            assertEqual(EMPTY_FINGERPRINT, await computeCodeFingerprint({ entries, contentRoots: CONTENT_ROOTS }));
            assertEqual(EMPTY_FINGERPRINT, await computeCodeFingerprint({ entries: [] }));
        });
    });

    group('refusals', ({ it }) => {
        const valid = { path: 'app/app.js', mode: '100644', oid: SHA1_OIDS.module };

        const cases = [
            [ 'mixed oid lengths', [ valid, { path: 'app/b.js', mode: '100644', oid: SHA256_OIDS.module }]],
            [ 'a bad mode', [{ path: 'app/app.js', mode: '040000', oid: SHA1_OIDS.module }]],
            [ 'an uppercase oid', [{ path: 'app/app.js', mode: '100644', oid: SHA1_OIDS.module.toUpperCase() }]],
            [ 'a duplicate path', [ valid, Object.assign({}, valid, { oid: SHA1_OIDS.hello }) ]],
            [ 'a leading /', [{ path: '/app/app.js', mode: '100644', oid: SHA1_OIDS.module }]],
            [ 'a .. segment', [{ path: 'app/../app.js', mode: '100644', oid: SHA1_OIDS.module }]],
            [ 'a lone surrogate', [{ path: 'app/\uD800.js', mode: '100644', oid: SHA1_OIDS.module }]],
        ];

        for (const [ description, entries ] of cases) {
            it(`refuses ${ description }`, async () => {
                const { computeCodeFingerprint } = getSubject();
                const error = await catchRejection(computeCodeFingerprint({ entries }));

                assert(error instanceof Error, description);
                assertEqual('AssertionError', error.name, description);
            });
        }
    });
}
