import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual, assertFunction, assertUndefined, assertNotEqual } from 'kixx-assert';
import sinon from 'sinon';
import PageTemplateEngine from '../../../view-service/page-template-engine.js';


const thisDirectory = path.dirname(fileURLToPath(import.meta.url));


describe('PageTemplateEngine:loadHelpers() for each file entry', ({ before, after, it }) => {
    let sandbox = null;
    let templateEngine = null;
    let eachHelper = null;
    let sumHelper = null;

    const templatesDirectory = path.join(thisDirectory, 'templates');
    const partialsDirectory = path.join(thisDirectory, 'partials');
    const helpersDirectory = path.join(thisDirectory, 'helpers');

    let fileSystem;

    before(async () => {
        const readDirectory = sinon.fake.returns(Promise.resolve([ 'each.js', 'lib', 'sum.js' ]));

        const getFileStats = sinon.fake((filepath) => {
            const filename = path.basename(filepath);

            if (filename === 'each.js') {
                return Promise.resolve({
                    isDirectory() {
                        return false;
                    },
                    isFile() {
                        return true;
                    },
                });
            }
            if (filename === 'sum.js') {
                return Promise.resolve({
                    isDirectory() {
                        return false;
                    },
                    isFile() {
                        return true;
                    },
                });
            }
            if (filename === 'lib') {
                return Promise.resolve({
                    isDirectory() {
                        return true;
                    },
                    isFile() {
                        return false;
                    },
                });
            }
        });

        const importAbsoluteFilepath = sinon.fake((filepath) => {
            const filename = path.basename(filepath);

            if (filename === 'each.js') {
                return Promise.resolve({
                    name: 'each',
                    helper() {},
                });
            }
            if (filename === 'sum.js') {
                return Promise.resolve({
                    name: 'sum',
                    helper() {},
                });
            }
        });

        fileSystem = { readDirectory, getFileStats, importAbsoluteFilepath };

        templateEngine = new PageTemplateEngine({
            fileSystem,
            templatesDirectory,
            partialsDirectory,
            helpersDirectory,
        });

        sandbox = sinon.createSandbox();

        sandbox.replace(fileSystem, 'readDirectory', readDirectory);
        sandbox.replace(fileSystem, 'getFileStats', getFileStats);
        sandbox.replace(fileSystem, 'importAbsoluteFilepath', importAbsoluteFilepath);

        eachHelper = templateEngine.helpers.get('each');
        sumHelper = templateEngine.helpers.get('sum');

        await templateEngine.loadHelpers();
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('reads the helpers directory', () => {
        assertEqual(1, fileSystem.readDirectory.callCount);
        assertEqual(helpersDirectory, fileSystem.readDirectory.getCall(0).args[0]);
    });

    it('imports each helper', () => {
        assertEqual(2, fileSystem.importAbsoluteFilepath.callCount);
        assertEqual(path.join(helpersDirectory, 'each.js'), fileSystem.importAbsoluteFilepath.getCall(0).args[0]);
        assertEqual(path.join(helpersDirectory, 'sum.js'), fileSystem.importAbsoluteFilepath.getCall(1).args[0]);
    });

    it('sets the exported helper by name', () => {
        assertFunction(templateEngine.helpers.get('each'));
        assertFunction(templateEngine.helpers.get('sum'));
        assertFunction(eachHelper);
        assertUndefined(sumHelper);
        // Overwrite the "each" helper.
        assertNotEqual(eachHelper, templateEngine.helpers.get('each'));
    });
});
