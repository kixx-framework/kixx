import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import TemplateStore from '../../lib/hyperview/template-store.js';


// Get the directory containing this test file - used as the base directory
// for TemplateStore in all tests. This pattern works for both CommonJS and ES modules.
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

const baseTemplatesDirectory = path.join(THIS_DIR, 'fake-templates');
const helpersDirectory = path.join(baseTemplatesDirectory, 'helpers');
const partialsDirectory = path.join(baseTemplatesDirectory, 'partials');
const templatesDirectory = path.join(baseTemplatesDirectory, 'templates');

describe('TemplateStore#getBaseTemplate() with a single part templateId beginning with a slash, like "/base.html"', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves('<html>base template</html>'),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getBaseTemplate('/base.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the full filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(templatesDirectory, 'base.html');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns a SourceFile object with filename and source', () => {
        assertEqual('/base.html', result.filename);
        assertEqual('<html>base template</html>', result.source);
    });
});

describe('TemplateStore#getBaseTemplate() with a nested templateId like "marketing/base.html"', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves('<html>marketing template</html>'),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getBaseTemplate('marketing/base.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the full filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(templatesDirectory, 'marketing', 'base.html');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns a SourceFile object with filename and source', () => {
        assertEqual('marketing/base.html', result.filename);
        assertEqual('<html>marketing template</html>', result.source);
    });
});

describe('TemplateStore#getBaseTemplate() when the source does not exist', ({ before, after, it }) => {

    const fileSystem = {
        readUtf8File: sinon.stub().resolves(null),
    };

    let store;
    let result;

    before(async () => {
        store = new TemplateStore({
            helpersDirectory,
            partialsDirectory,
            templatesDirectory,
            fileSystem,
        });

        result = await store.getBaseTemplate('nonexistent.html');
    });

    after(() => {
        sinon.restore();
    });

    it('calls readUtf8File() with the full filepath', () => {
        assertEqual(1, fileSystem.readUtf8File.callCount);
        const expectedPath = path.join(templatesDirectory, 'nonexistent.html');
        assertEqual(expectedPath, fileSystem.readUtf8File.firstCall.firstArg);
    });

    it('returns `null`', () => {
        assertEqual(null, result);
    });
});
