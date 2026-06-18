import DocumentStore from '../kixx/document-store/document-store.js';


const DOCUMENT_STORE_INDEXES = [];


export function register(context) {
    const documentStore = new DocumentStore();

    context.registerService('DocumentStore', documentStore);
}

export function initialize(context) {
    const documentStore = context.getService('DocumentStore');
    const documentStoreEngine = context.getService('DocumentStoreEngine');

    documentStore.initialize({
        engine: documentStoreEngine,
        indexes: DOCUMENT_STORE_INDEXES,
    });
}
