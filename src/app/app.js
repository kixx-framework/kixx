import DocumentStore from '../kixx/document-store/document-store.js';
import AdminUserCollection from './collections/admin-user-collection.js';
import UserSessionCollection from './collections/user-session-collection.js';


// Each document store collection owns its own secondary index definitions
// (name + jsonPath). Collect them here so registration stays pure wiring and
// the index details live next to the queries that use them.
const DOCUMENT_STORE_INDEXES = [
    ...AdminUserCollection.INDEXES,
];


export function register(context) {
    const documentStore = new DocumentStore();

    context.registerService('DocumentStore', documentStore);

    // Admin users live in the document store; sessions live in the
    // eventually-consistent key/value store, which plugins register before this
    // hook runs.
    context.registerCollection('AdminUser', new AdminUserCollection({ db: documentStore }));

    const keyValueStore = context.getService('KeyValueStore');
    context.registerCollection('UserSession', new UserSessionCollection({ db: keyValueStore }));
}

export function initialize(context) {
    const documentStore = context.getService('DocumentStore');
    const documentStoreEngine = context.getService('DocumentStoreEngine');

    documentStore.initialize({
        engine: documentStoreEngine,
        indexes: DOCUMENT_STORE_INDEXES,
    });
}
