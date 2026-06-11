import TemplateFileStore from './lib/template-file-store.js';

export function register(context) {
    const { logger } = context;
    context.registerService('HyperviewTemplateFileStore', new TemplateFileStore({ logger }));
}
