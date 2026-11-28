// The registries and example.env.secrets are generated from the manifests:
// kixx/plugin.json, each plugins/<name>/plugin.json, and app/app.json. They
// are committed, and never edited. This test fails when one is missing or
// differs from what the generator writes: regenerate after changing a
// manifest or installing a plugin.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert } from 'kixx-assert';

import { renderProjectFiles } from '../kixx/tooling/mod.js';
import { createProjectFileSystem } from '../kixx/adapters/node/tooling/lib/project-file-system.js';


const PROJECT_DIRECTORY = fileURLToPath(new URL('../', import.meta.url));


describe('generated files', ({ before, it }) => {
    let rendered;

    before(async () => {
        rendered = await renderProjectFiles({
            fileSystem: createProjectFileSystem(PROJECT_DIRECTORY),
        });
    });

    it('are committed exactly as the generator writes them', () => {
        assert(rendered.size > 0, 'the generator rendered no file');

        for (const [ fileName, text ] of rendered) {
            const filepath = path.join(PROJECT_DIRECTORY, fileName);

            assert(fs.existsSync(filepath), `${ fileName } is missing. Regenerate the project's generated files.`);
            assert(
                fs.readFileSync(filepath, 'utf8') === text,
                `${ fileName } is out of date. Regenerate the project's generated files.`,
            );
        }
    });
});
