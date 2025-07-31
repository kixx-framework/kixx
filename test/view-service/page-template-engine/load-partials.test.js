import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual, assertFunction } from 'kixx-assert';
import sinon from 'sinon';
import PageTemplateEngine from '../../../lib/view-service/page-template-engine.js';


const thisDirectory = path.dirname(fileURLToPath(import.meta.url));


describe('PageTemplateEngine:loadPartials() for each nested directory entry', ({ before, after, it }) => {
    let sandbox = null;
    let templateEngine = null;

    const templatesDirectory = path.join(thisDirectory, 'templates');
    const partialsDirectory = path.join(thisDirectory, 'partials');
    const helpersDirectory = path.join(thisDirectory, 'helpers');

    let fileSystem;

    before(async () => {
        const readDirectory = sinon.fake((filepath) => {
            if (filepath === partialsDirectory) {
                return [
                    path.join(filepath, 'posts'),
                    path.join(filepath, 'book.html'),
                ];
            }
            if (filepath === path.join(partialsDirectory, 'posts')) {
                return [ path.join(filepath, 'comment.html') ];
            }
            return [];
        });

        const getFileStats = sinon.fake((filepath) => {
            const filename = path.basename(filepath);

            if (filename === 'book.html' || filename === 'comment.html') {
                return Promise.resolve({
                    isDirectory() {
                        return false;
                    },
                    isFile() {
                        return true;
                    },
                });
            }
            return Promise.resolve({
                isDirectory() {
                    return true;
                },
                isFile() {
                    return false;
                },
            });
        });

        const readUtf8File = sinon.fake((filepath) => {
            return Promise.resolve({ filepath });
        });

        fileSystem = { readDirectory, getFileStats, readUtf8File };

        templateEngine = new PageTemplateEngine({
            fileSystem,
            templatesDirectory,
            partialsDirectory,
            helpersDirectory,
        });

        sandbox = sinon.createSandbox();

        sandbox.replace(fileSystem, 'readDirectory', readDirectory);
        sandbox.replace(fileSystem, 'getFileStats', getFileStats);
        sandbox.replace(fileSystem, 'readUtf8File', readUtf8File);

        sandbox.replace(templateEngine, 'compileTemplate', sinon.fake.returns(function template() {}));

        await templateEngine.loadPartials();
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('reads nested directories', () => {
        assertEqual(2, fileSystem.readDirectory.callCount);
        assertEqual(partialsDirectory, fileSystem.readDirectory.getCall(0).args[0]);
        assertEqual(path.join(partialsDirectory, 'posts'), fileSystem.readDirectory.getCall(1).args[0]);
    });

    it('compiles each partial', () => {
        assertEqual(2, templateEngine.compileTemplate.callCount);
        assertEqual('posts/comment.html', templateEngine.compileTemplate.getCall(0).args[0]);
        assertEqual(
            path.join(partialsDirectory, 'posts', 'comment.html'),
            templateEngine.compileTemplate.getCall(0).args[1].filepath
        );
        assertEqual('book.html', templateEngine.compileTemplate.getCall(1).args[0]);
        assertEqual(
            path.join(partialsDirectory, 'book.html'),
            templateEngine.compileTemplate.getCall(1).args[1].filepath
        );
    });

    it('sets each partial by id', () => {
        assertFunction(templateEngine.partials.get('book.html'));
        assertFunction(templateEngine.partials.get('posts/comment.html'));
    });
});
