import DocumentStore from '../kixx/document-store/document-store.js';
import AdminUserCollection, { ADMIN_USER_EMAIL_ADDRESS_INDEX } from './collections/admin-user-collection.js';
import UserSessionCollection from './collections/user-session-collection.js';


const DOCUMENT_STORE_INDEXES = [
    // Backs AdminUserCollection#getByEmailAddress for the duplicate-email check.
    { name: ADMIN_USER_EMAIL_ADDRESS_INDEX, jsonPath: '$.emailAddress' },
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
