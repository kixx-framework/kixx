import { assert, assertEqual } from '../../../kixx/assertions/mod.js';
import { canonicalize } from '../../../kixx/content-addressable-store/addressing.js';
import {
    validateReleaseManifest,
    validateStructuredContent,
} from '../../../kixx/content-addressable-store/release-manifest.js';


// One small project that uses every content convention: a root page and a
// nested page with a template, two page partials, and an include; a page
// with metadata only; two global partials whose names sort differently as
// whole paths than as a directory walk; a base template; a stylesheet with a
// local @import and its library file; a script with comments, a string that
// looks like a comment, and a hashbang; a binary public file; and one file no
// convention matches.
function makeGoldenFiles() {
    return {
        'pages/page.json': '{"template":"page.html","page":{"title":"Home"}}',
        'pages/page.html': '<h1>{{ page.title }}</h1>\n',
        'pages/blog/first-post/page.json': '{"template":"layouts/post.html","partials":[{"id":"teaser","filename":"teaser.html"},{"id":"byline","filename":"parts/byline.html"}],"includes":{"body":{"filename":"body.md"}},"page":{"title":"First post"}}',
        'pages/blog/first-post/layouts/post.html': '<article>{{> byline }}{{> teaser }}{{> admin-nav.html }}</article>\n',
        'pages/blog/first-post/teaser.html': '<p class="teaser">Teaser</p>\n',
        'pages/blog/first-post/parts/byline.html': '<p class="byline">By Kixx</p>\n',
        'pages/blog/first-post/body.md': '# First post\n\nCaf\u00e9 \u2014 body text.\n',
        'pages/blog/first-post/notes.txt': 'No page.json references this file.\n',
        'pages/about/page.json': '{"page":{"title":"About","description":"Metadata only"}}',
        'templates/partials/admin-nav.html': '<nav>Admin</nav>\n',
        'templates/partials/admin/notice.html': '<p class="notice">Notice</p>\n',
        'templates/base/default.html': '<!doctype html>\n<html><body>{{> admin/notice.html }}{{unescape content}}</body></html>\n',
        'static-assets/stylesheets/site.css': '@import "lib/reset.css";\n\n/* Site styles */\nbody { background: url(../images/bg.png); }\n',
        'static-assets/stylesheets/lib/reset.css': '/* Reset */\n* { margin: 0; }\n',
        'static-assets/scripts/app.js': '#!/usr/bin/env node\n// A line comment\nconst text = "// not a comment"; /* a block\ncomment */\nexport default text;\n',
        'public/favicon.ico': Uint8Array.from([ 0, 1, 127, 128, 200, 255 ]),
    };
}

// The type, pathname, object id, and size of every object, in order.
//
// These literals were produced by the v6 scanner (the devkit at the tag
// v6-final) from the tree above, not by the compiler under test. They are what
// "the compiler's output is v6's" means. An id here changes only when the
// content contract or the addressing format changes, and both are versioned:
// don't regenerate these to make a failing test pass.
const GOLDEN_OBJECTS = [
    [ 'BaseTemplates', '/', 'xjtz2vkah54ztigrxlafzmkfw4', 124 ],
    [ 'GlobalTemplatePartials', '/', 'lefoopxgebdnvgzo66wijz33da', 126 ],
    [ 'PageIncludes', '/', 'fcr2dd3m2zagwcdot762d6nyue', 2 ],
    [ 'PageIncludes', '/about', 'fcr2dd3m2zagwcdot762d6nyue', 2 ],
    [ 'PageIncludes', '/blog/first-post', 'kcabgtq3hnzvlztirrxjpkl3dm', 49 ],
    [ 'PageMetadata', '/', 's6c56z6jevem3pkgvez3vlpmha', 48 ],
    [ 'PageMetadata', '/about', 'qythlkr336suvhfmtx5ff6eao4', 56 ],
    [ 'PageMetadata', '/blog/first-post', '4nssgnlzibuqrcl3ngm3bqdevm', 206 ],
    [ 'PagePartials', '/', '6nykzsoyw42nsb6ro7xst5ynie', 2 ],
    [ 'PagePartials', '/about', '6nykzsoyw42nsb6ro7xst5ynie', 2 ],
    [ 'PagePartials', '/blog/first-post', 'osudy7zz3cckw4fj7opegtoso4', 122 ],
    [ 'PageTemplate', '/blog/first-post/post.html', 'wvklvloup5xnoitw4txlck7luq', 67 ],
    [ 'PageTemplate', '/page.html', '7rxn2ch2aej6s6mbccyzrjoaee', 26 ],
    [ 'StaticAsset', 'favicon.ico', '4acmkcifec2vvpxfbn3m3v6us4', 6 ],
    [ 'StaticAsset', 'scripts/app.js', 'x4s2kddi2y3uasub5cmhshu3e4', 78 ],
    [ 'StaticAsset', 'stylesheets/lib/reset.css', '2bkn6qpwuhu2yuf5v46kuerjni', 18 ],
    [ 'StaticAsset', 'stylesheets/site.css', 'a7wkpetrjgpie35xgz3z4gn4vy', 65 ],
];

// The canonical JSON of the Release manifest, split only to keep the lines
// short. It is v6's manifest with its empty `emails` key removed: v6 composed
// content contract 1, and contract 2 has no `emails`.
const GOLDEN_MANIFEST = [
    '{"baseTemplates":{"objectId":"xjtz2vkah54ztigrxlafzmkfw4","size":124},"globalTemplatePartials":{',
    '"objectId":"lefoopxgebdnvgzo66wijz33da","size":126},"pages":{"/":{"includes":{"objectId":"fcr2dd',
    '3m2zagwcdot762d6nyue","size":2},"metadata":{"objectId":"s6c56z6jevem3pkgvez3vlpmha","size":48},"',
    'partials":{"objectId":"6nykzsoyw42nsb6ro7xst5ynie","size":2},"templates":{"page.html":{"objectId',
    '":"7rxn2ch2aej6s6mbccyzrjoaee","size":26}}},"/about":{"includes":{"objectId":"fcr2dd3m2zagwcdot7',
    '62d6nyue","size":2},"metadata":{"objectId":"qythlkr336suvhfmtx5ff6eao4","size":56},"partials":{"',
    'objectId":"6nykzsoyw42nsb6ro7xst5ynie","size":2}},"/blog/first-post":{"includes":{"objectId":"kc',
    'abgtq3hnzvlztirrxjpkl3dm","size":49},"metadata":{"objectId":"4nssgnlzibuqrcl3ngm3bqdevm","size":',
    '206},"partials":{"objectId":"osudy7zz3cckw4fj7opegtoso4","size":122},"templates":{"post.html":{"',
    'objectId":"wvklvloup5xnoitw4txlck7luq","size":67}}}},"staticAssets":{"/favicon.ico":{"objectId":',
    '"4acmkcifec2vvpxfbn3m3v6us4","size":6},"/scripts/app.js":{"objectId":"x4s2kddi2y3uasub5cmhshu3e4',
    '","size":78},"/stylesheets/lib/reset.css":{"objectId":"2bkn6qpwuhu2yuf5v46kuerjni","size":18},"/',
    'stylesheets/site.css":{"objectId":"a7wkpetrjgpie35xgz3z4gn4vy","size":65}}}',
].join('');

const GOLDEN_UNMATCHED_FILES = [
    'pages/blog/first-post/notes.txt',
];

const STRUCTURED_KINDS = {
    GlobalTemplatePartials: 'globalTemplatePartials',
    BaseTemplates: 'baseTemplates',
    PageMetadata: 'pageMetadata',
    PagePartials: 'pagePartials',
    PageIncludes: 'pageIncludes',
};

/**
 * @callback MakeContentCompilerSubject
 * @returns {{ compileContent: Function, createMemoryContentSource: Function }} The content compiler's exports under test.
 */

/**
 * The content compiler's output for one fixed project, as one suite.
 *
 * Object ids are persisted in every published Release, so the same content
 * must compile to the same objects on every runtime and in every version.
 * The unit suite checks that on the runtime running the tests. The same
 * cases can also run on real platforms, against the copy of the compiler
 * deployed there, which is why the compiler arrives through a factory
 * instead of an import.
 *
 * Before you change it, read the rules for suites that run on a real platform
 * in `test/README.md`, under "Shared Conformance Suites".
 *
 * @param {Function} describe - Nested `describe` handle from the enclosing block.
 * @param {MakeContentCompilerSubject} makeSubject - Returns the compiler under test. Called once per test.
 */
export default function contentCompilerGoldens(describe, makeSubject) {
    async function compileGoldenProject() {
        const { compileContent, createMemoryContentSource } = makeSubject();

        return await compileContent({
            source: createMemoryContentSource(makeGoldenFiles()),
            pluginContentRoots: [],
            templateHelpers: [ 'unescape' ],
        });
    }

    describe('content compiler goldens', ({ it }) => {
        it('reports no problem', async () => {
            const { report } = await compileGoldenProject();

            assertEqual('[]', JSON.stringify(report.problems));
        });

        it('lists the unmatched file', async () => {
            const { report } = await compileGoldenProject();

            assertEqual(GOLDEN_UNMATCHED_FILES.join('\n'), report.unmatchedFiles.join('\n'));
        });

        it('builds every object with its golden id and size, in order', async () => {
            const { objects } = await compileGoldenProject();

            assertEqual(
                GOLDEN_OBJECTS.map((golden) => golden.join(' ')).join('\n'),
                objects.map(({ type, pathname, hash, size }) => `${ type } ${ pathname } ${ hash } ${ size }`).join('\n'),
            );
        });

        it('builds the golden Release manifest', async () => {
            const { release } = await compileGoldenProject();

            assert(release, 'expected a release');
            assertEqual(GOLDEN_MANIFEST, canonicalize(release.manifest));
        });

        it('builds a manifest and structured objects that pass validation', async () => {
            const { objects, release } = await compileGoldenProject();

            assertEqual(GOLDEN_OBJECTS.length, validateReleaseManifest(release.manifest).length);

            for (const object of objects) {
                const kind = STRUCTURED_KINDS[object.type];

                if (kind) {
                    validateStructuredContent(kind, object.payload);
                }
            }
        });
    });
}
