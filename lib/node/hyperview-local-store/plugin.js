/**
 * Kixx Hyperview plugin for Node.js local filesystem.
 *
 * Registers and initializes the full Hyperview stack (PageStore, TemplateStore,
 * StaticFileServerStore, TemplateEngine, HyperviewService, and HTTP handlers)
 * using local filesystem stores.
 *
 * @see {import('../../ports/plugin.js').Plugin} Plugin port
 * @module node/hyperview-local-store/plugin
 */
import path from 'node:path';
import * as fileSystem from '../filesystem/mod.js';
import PageStore from './page-store.js';
import StaticFileServerStore from './static-file-server-store.js';
import TemplateStore from './template-store.js';
import TemplateEngine from '../../hyperview/template-engine.js';
import HyperviewService from '../../hyperview/hyperview-service.js';
import RequestHandler from '../../hyperview/request-handler.js';
import ErrorHandler from '../../hyperview/error-handler.js';


export function register(applicationContext) {
    const { applicationDirectory } = applicationContext.config;
    const pageStore = new PageStore({
        directory: path.join(applicationDirectory, 'pages'),
        fileSystem,
    });

    const staticFileServerStore = new StaticFileServerStore({
        publicDirectory: path.join(applicationDirectory, 'public'),
        fileSystem,
    });

    const templatesDirectory = path.join(applicationDirectory, 'templates');

    const templateStore = new TemplateStore({
        helpersDirectory: path.join(templatesDirectory, 'helpers'),
        partialsDirectory: path.join(templatesDirectory, 'partials'),
        templatesDirectory: path.join(templatesDirectory, 'base-templates'),
        fileSystem,
    });

    const templateEngine = new TemplateEngine();

    applicationContext.registerService('Hyperview', new HyperviewService({
        pageStore,
        staticFileServerStore,
        templateStore,
        templateEngine,
    }));

    applicationContext.registerRequestHandler('HyperviewRequestHandler', RequestHandler);
    applicationContext.registerErrorHandler('HyperviewErrorHandler', ErrorHandler);
}

export async function initialize(applicationContext) {
    const hyperviewService = applicationContext.getService('Hyperview');
    await hyperviewService.initialize();
}
