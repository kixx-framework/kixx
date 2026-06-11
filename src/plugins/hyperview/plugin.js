import HyperviewService from '../../kixx/hyperview/hyperview-service.js';


export function register(context) {
    const { logger } = context;
    context.registerService('Hyperview', new HyperviewService({ logger }));
}

export function initialize(context) {
    const hyperviewService = context.getService('Hyperview');
    const pageDataStore = context.getService('HyperviewPageDataStore');
    const templateFileStore = context.getService('HyperviewTemplateFileStore');
    hyperviewService.initialize({ pageDataStore, templateFileStore });
}
