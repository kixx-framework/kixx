import DocumentStore from '../kixx/document-store/document-store.js';
import CsrfTokenSigner from './presentation/lib/csrf-token-signer.js';
import AdminInviteCollection from './collections/admin-invite-collection.js';
import AdminUserCollection from './collections/admin-user-collection.js';
import ActivationCollection from './collections/activation-collection.js';
import MigrationCollection from './collections/migration-collection.js';
import PublishingApiTokenCollection from './collections/publishing-api-token-collection.js';
import RateLimitCollection from './collections/rate-limit-collection.js';
import ReleaseCollection from './collections/release-collection.js';
import UserSessionCollection from './collections/user-session-collection.js';
import FileCollection from './collections/file-collection.js';
import FileContentCollection from './collections/file-content-collection.js';
import { assert, assertNonEmptyString, isPlainObject } from '../kixx/assertions/mod.js';


// Each document store collection owns its own secondary index definitions
// (name + jsonPath). Collect them here so registration stays pure wiring and
// the index details live next to the queries that use them.
const DOCUMENT_STORE_INDEXES = [
    ...AdminUserCollection.INDEXES,
    ...ActivationCollection.INDEXES,
];

const DOCUMENT_STORE_CURSOR_SIGNING_SECRET = 'DOCUMENT_STORE_CURSOR_SIGNING_SECRET';
const CSRF_TOKEN_SIGNING_SECRET = 'CSRF_TOKEN_SIGNING_SECRET';


export function register(context) {
    const filesConfig = context.config?.env?.FILES;
    assert(isPlainObject(filesConfig), 'app requires context.config.env.FILES');
    assert(
        Number.isSafeInteger(filesConfig.maxUploadBytes) && filesConfig.maxUploadBytes >= 0,
        'app requires context.config.env.FILES.maxUploadBytes to be a nonnegative safe integer',
    );
    assertNonEmptyString(filesConfig.bucket, 'app requires context.config.env.FILES.bucket');
    assert(
        context.config?.env?.OBJECT_STORE?.buckets?.[filesConfig.bucket],
        'app requires context.config.env.FILES.bucket to name a configured object-store bucket',
    );

    const documentStore = new DocumentStore();
    const keyValueStore = context.getService('KeyValueStore');
    const objectStore = context.getService('ObjectStore');

    context.registerService('DocumentStore', documentStore);

    context.registerCollection('AdminUser', new AdminUserCollection({ db: documentStore }));
    context.registerCollection('Activation', new ActivationCollection({ db: documentStore }));
    context.registerCollection('AdminInvite', new AdminInviteCollection({ db: documentStore }));
    context.registerCollection('Migration', new MigrationCollection({ db: documentStore }));
    context.registerCollection('PublishingApiToken', new PublishingApiTokenCollection({ db: documentStore }));
    context.registerCollection('RateLimit', new RateLimitCollection({ db: keyValueStore }));
    context.registerCollection('Release', new ReleaseCollection({ db: documentStore }));
    context.registerCollection('UserSession', new UserSessionCollection({ db: keyValueStore }));
    context.registerCollection('File', new FileCollection({ db: documentStore }));
    context.registerCollection('FileContent', new FileContentCollection({
        store: objectStore,
        bucket: filesConfig.bucket,
        maxUploadBytes: filesConfig.maxUploadBytes,
    }));
}

export function initialize(context) {
    const documentStore = context.getService('DocumentStore');
    const documentStoreEngine = context.getService('DocumentStoreEngine');

    // Signs and verifies public pagination cursors returned from the DocumentStore.
    const cursorSigningSecret = context.getEnvString(DOCUMENT_STORE_CURSOR_SIGNING_SECRET, {
        required: true,
    });

    documentStore.initialize({
        engine: documentStoreEngine,
        indexes: DOCUMENT_STORE_INDEXES,
        cursorSigningSecret,
    });

    // Signs and verifies stateless CSRF tokens. Read here rather than deferred
    // to first use, so a missing secret fails boot loudly instead of leaving a
    // silently unsigned CSRF subsystem running.
    const csrfTokenSigningSecret = context.getEnvString(CSRF_TOKEN_SIGNING_SECRET, {
        required: true,
    });

    context.registerService('CsrfTokenSigner', new CsrfTokenSigner(csrfTokenSigningSecret));
}
