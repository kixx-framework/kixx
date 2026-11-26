import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { compileProjectContent, serializeContentObject } from '../../kixx/tooling/mod.js';
import { createProjectFileSystem } from '../../kixx/adapters/node/tooling/lib/project-file-system.js';
import { createFileSystemContentSource } from '../../kixx/adapters/node/content-compiler/lib/file-system-content-source.js';
import { validateReleaseManifest } from '../../kixx/content-addressable-store/release-manifest.js';


const PROJECT_DIRECTORY = fileURLToPath(new URL('./project/', import.meta.url));

// Where core is, from the fixture. A real project holds it at ./kixx.
const CORE_DIRECTORY = '../../../kixx';

const VISITS_MANIFEST_FILE = 'plugins/visits/plugin.json';


// Compiles the fixture the way a command line tool compiles a project: the
// tooling entry, and the two Node.js adapters. `fileSystem` replaces the
// manifest reader, to compile with a changed copy of a manifest.
async function compileFixture(fileSystem) {
    return await compileProjectContent({
        fileSystem: fileSystem ?? createProjectFileSystem(PROJECT_DIRECTORY),
        source: createFileSystemContentSource(PROJECT_DIRECTORY),
        coreDirectory: CORE_DIRECTORY,
    });
}

// The fixture's manifests, with one changed in memory. The files on disk
// are never touched.
function withChangedManifest(file, change) {
    const fileSystem = createProjectFileSystem(PROJECT_DIRECTORY);

    return {
        listDirectories: (path) => fileSystem.listDirectories(path),

        async readTextFile(path) {
            const text = await fileSystem.readTextFile(path);

            return path === file ? JSON.stringify(change(JSON.parse(text))) : text;
        },
    };
}


describe('fixture project: content', ({ before, it }) => {
    let compilation;

    before(async () => {
        compilation = await compileFixture();
    });

    it('compiles with no problem and no unmatched file', () => {
        assertEqual('[]', JSON.stringify(compilation.report.problems));
        assertEqual('[]', JSON.stringify(compilation.report.pages));
        assertEqual('', compilation.report.unmatchedFiles.join());
        assert(compilation.release, 'expected a Release');
    });

    it('puts the project\'s page and the plugin\'s page in one manifest', () => {
        const { manifest } = compilation.release;

        assertEqual('/,/visits', Object.keys(manifest.pages).join());
        assertEqual('page.html', Object.keys(manifest.pages['/'].templates).join());
        assertEqual('page.html', Object.keys(manifest.pages['/visits'].templates).join());
        assertEqual('/robots.txt,/site.css', Object.keys(manifest.staticAssets).join());
        assert(manifest.baseTemplates, 'expected the base templates');
        assert(manifest.globalTemplatePartials, 'expected the global partials');
    });

    it('builds a manifest the content store accepts, with one entry per object', () => {
        const files = validateReleaseManifest(compilation.release.manifest);

        assertEqual(compilation.objects.length, files.length);
    });

    it('reads the plugin\'s page from the plugin\'s directory', () => {
        const pluginObjects = compilation.objects.filter(({ pathname }) => pathname.startsWith('/visits'));

        assertEqual('PageIncludes,PageMetadata,PagePartials,PageTemplate', pluginObjects.map(({ type }) => type).join());

        for (const { sourceFiles } of pluginObjects) {
            assert(sourceFiles.length > 0);

            for (const file of sourceFiles) {
                assert(file.startsWith('plugins/visits/pages/visits/'), file);
            }
        }
    });

    it('links each page to its owner, its files, and the project\'s global partial', () => {
        const [ home, visits ] = compilation.graph.pages;

        assertEqual('/ app pages/page.html', `${ home.pathname } ${ home.owner } ${ home.templateFile }`);
        assertEqual(
            '/visits visits plugins/visits/pages/visits/page.html',
            `${ visits.pathname } ${ visits.owner } ${ visits.templateFile }`,
        );

        // A plugin's template may use a global partial the project supplies.
        assertEqual('site-nav.html', home.globalPartials.join());
        assertEqual('site-nav.html', visits.globalPartials.join());
        assertEqual('default.html', compilation.graph.baseTemplates.map(({ id }) => id).join());
    });

    it('stores the stylesheet as text and the public file as its bytes', () => {
        const stylesheet = compilation.objects.find(({ pathname }) => pathname === 'site.css');
        const robots = compilation.objects.find(({ pathname }) => pathname === 'robots.txt');

        assertEqual('static-assets/site.css', stylesheet.sourceFiles.join());
        assertEqual('User-agent: *\nDisallow:\n', new TextDecoder().decode(serializeContentObject(robots)));
    });

    // The plugin's page uses its helper with an argument, so the compile
    // depends on the declaration in the plugin's manifest.
    it('refuses the Release when the plugin does not declare its template helper', async () => {
        const fileSystem = withChangedManifest(VISITS_MANIFEST_FILE, (manifest) => {
            delete manifest.templateHelpers;
            return manifest;
        });

        const { release, report } = await compileFixture(fileSystem);

        assertEqual(null, release);
        assertEqual(1, report.problems.length);

        const [ problem ] = report.problems;

        assertEqual('unregistered-helper', problem.code);
        assertEqual('visitCount', problem.helper);
        assertEqual('plugins/visits/pages/visits/page.html', problem.filepath);
        assertEqual('/visits', problem.page);
        assertEqual('/visits', report.pages.map(({ pathname }) => pathname).join());
    });

    it('refuses the Release when the app does not declare its template helper', async () => {
        const fileSystem = withChangedManifest('app/app.json', (manifest) => {
            delete manifest.templateHelpers;
            return manifest;
        });

        const { release, report } = await compileFixture(fileSystem);

        assertEqual(null, release);
        assertEqual('unregistered-helper fixtureGreeting pages/page.html', report.problems.map((problem) => {
            return `${ problem.code } ${ problem.helper } ${ problem.filepath }`;
        }).join());
    });
});
