import TemplateFileStore from './lib/template-file-store.js';

export function register(context) {
    const { logger } = context;
    const { directory } = context.env.TEMPLATE_FILE_STORE ?? {};
    context.registerService('HyperviewTemplateFileStore', new TemplateFileStore({ logger, directory }));
}
