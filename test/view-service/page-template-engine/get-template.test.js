import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import PageTemplateEngine from '../../../lib/view-service/page-template-engine.js';


const thisDirectory = path.dirname(fileURLToPath(import.meta.url));


describe('PageTemplateEngine:getTemplate()', ({ before, after, it }) => {
    let sandbox = null;
    let templateEngine = null;
    let readUtf8File = null;

    const templateId = '/admin/dash.html';
    const templateSource = '<html></html>';
    const template = {};

    const templatesDirectory = path.join(thisDirectory, 'templates');
    const partialsDirectory = path.join(thisDirectory, 'partials');
    const helpersDirectory = path.join(thisDirectory, 'helpers');

    let result;

    before(async () => {
        readUtf8File = sinon.fake.returns(Promise.resolve(templateSource));
        const fileSystem = { readUtf8File };

        templateEngine = new PageTemplateEngine({
            fileSystem,
            templatesDirectory,
            partialsDirectory,
            helpersDirectory,
        });

        sandbox = sinon.createSandbox();

        sandbox.replace(templateEngine, 'loadHelpers', sinon.fake.returns(Promise.resolve()));
        sandbox.replace(templateEngine, 'loadPartials', sinon.fake.returns(Promise.resolve()));
        sandbox.replace(templateEngine, 'compileTemplate', sinon.fake.returns(template));

        result = await templateEngine.getTemplate(templateId);
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('loads helpers and partials', () => {
        assertEqual(1, templateEngine.loadHelpers.callCount);
        assertEqual(1, templateEngine.loadPartials.callCount);
    });

    it('reads the template source and compiles the template', () => {
        assertEqual(1, readUtf8File.callCount);
        assertEqual(1, templateEngine.compileTemplate.callCount);

        assertEqual(path.join(templatesDirectory, 'admin', 'dash.html'), readUtf8File.getCall(0).args[0]);
        assertEqual(templateId, templateEngine.compileTemplate.getCall(0).args[0]);
        assertEqual(templateSource, templateEngine.compileTemplate.getCall(0).args[1]);
    });

    it('returns the template', () => {
        assertEqual(template, result);
    });
});

describe('PageTemplateEngine:getTemplate() with no source', ({ before, after, it }) => {
    let sandbox = null;
    let templateEngine = null;
    let readUtf8File = null;

    const templateId = 'admin/dash.html';
    const templateSource = null;
    const template = {};

    const templatesDirectory = path.join(thisDirectory, 'templates');
    const partialsDirectory = path.join(thisDirectory, 'partials');
    const helpersDirectory = path.join(thisDirectory, 'helpers');

    let result;

    before(async () => {
        readUtf8File = sinon.fake.returns(Promise.resolve(templateSource));
        const fileSystem = { readUtf8File };

        templateEngine = new PageTemplateEngine({
            fileSystem,
            templatesDirectory,
            partialsDirectory,
            helpersDirectory,
        });

        sandbox = sinon.createSandbox();

        sandbox.replace(templateEngine, 'loadHelpers', sinon.fake.returns(Promise.resolve()));
        sandbox.replace(templateEngine, 'loadPartials', sinon.fake.returns(Promise.resolve()));
        sandbox.replace(templateEngine, 'compileTemplate', sinon.fake.returns(template));

        result = await templateEngine.getTemplate(templateId);
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('loads helpers and partials', () => {
        assertEqual(1, templateEngine.loadHelpers.callCount);
        assertEqual(1, templateEngine.loadPartials.callCount);
    });

    it('reads the template source and compiles the template', () => {
        assertEqual(1, readUtf8File.callCount);
        assertEqual(0, templateEngine.compileTemplate.callCount);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});
