import { MethodNotAllowedError, NotFoundError } from '../../../../kixx/errors/mod.js';
import { adminDataResources } from '../../../admin-data-api/mod.js';
import AdminDataRecordForm from '../../forms/admin-data-api/admin-data-record-form.js';
import { assertStrictJsonApiContentType, respondWithJsonApi, withErrorSource } from '../../lib/json-api.js';
import { authorizeAdminDataAction } from '../../../transaction-scripts/admin-data-api/lib.js';
import { createAdminDataRecord } from '../../../transaction-scripts/admin-data-api/create-admin-data-record.js';
import { deleteAdminDataRecord } from '../../../transaction-scripts/admin-data-api/delete-admin-data-record.js';
import { getAdminDataRecord } from '../../../transaction-scripts/admin-data-api/get-admin-data-record.js';
import { listAdminDataRecords } from '../../../transaction-scripts/admin-data-api/list-admin-data-records.js';
import { updateAdminDataRecord } from '../../../transaction-scripts/admin-data-api/update-admin-data-record.js';
import {
    assertNoQueryParameters,
    nextPageUrl,
    parseFieldsQuery,
    parseListQuery,
    readExpectedVersionHeader,
    serializeResource,
} from './protocol.js';


// The operation each HTTP method selects. Both routes accept every method so
// that an unsupported one is answered after authentication, with an Allow
// header derived from the current registration rather than the route table.
const COLLECTION_OPERATIONS = { GET: 'list', POST: 'create' };
const RESOURCE_OPERATIONS = { GET: 'get', PATCH: 'update', DELETE: 'delete' };


/**
 * Serves `/admin-data-api/v1/:type`: lists records (GET) or creates one (POST).
 * @param {import('../../../../kixx/context/request-context.js').default} context - Request context carrying the token principal.
 * @param {Object} request - Incoming request.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} JSON:API response.
 * @throws {NotFoundError} When the type is not registered.
 * @throws {MethodNotAllowedError} When the method selects no enabled operation; carries `allowedMethods`.
 * @throws {ForbiddenError} When the token lacks the selected action.
 */
export async function handleCollectionRequest(context, request, response) {
    const { type } = request.pathnameParams;
    const { resource, action } = selectOperation(context, request, type, COLLECTION_OPERATIONS);

    if (action === 'list') {
        return await listRecords(context, request, response, resource);
    }

    return await createRecord(context, request, response, resource);
}

/**
 * Serves `/admin-data-api/v1/:type/:id`: reads (GET), updates (PATCH), or deletes (DELETE) one record.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Request context carrying the token principal.
 * @param {Object} request - Incoming request.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} JSON:API response, or an empty 204 after a delete.
 * @throws {NotFoundError} When the type is not registered or the record is absent.
 * @throws {MethodNotAllowedError} When the method selects no enabled operation; carries `allowedMethods`.
 * @throws {ForbiddenError} When the token lacks the selected action.
 * @throws {ConflictError} When a write's version is stale or the body does not match the URL.
 */
export async function handleResourceRequest(context, request, response) {
    const { type, id } = request.pathnameParams;
    const { resource, action } = selectOperation(context, request, type, RESOURCE_OPERATIONS);

    if (action === 'get') {
        return await getRecord(context, request, response, resource, id);
    }

    if (action === 'update') {
        return await updateRecord(context, request, response, resource, id);
    }
    return await deleteRecord(context, request, response, resource, id);
}

async function listRecords(context, request, response, resource) {
    const query = parseListQuery(request, resource);

    let page;
    try {
        page = await listAdminDataRecords(context, resource.type, query);
    } catch (error) {
        if (error.code === 'AdminDataInvalidCursor') {
            withErrorSource(error, { parameter: 'page[after]' });
        }
        throw error;
    }

    const links = { self: request.url.href };

    if (page.cursor) {
        links.next = nextPageUrl(context, request, resource.type, query.preserved, page.cursor);
    }

    return respondWithJsonApi(response, 200, {
        data: page.items.map((record) => serializeResource(context, record, query.fields)),
        links,
    });
}

async function getRecord(context, request, response, resource, id) {
    const fields = parseFieldsQuery(request, resource);
    const record = await getAdminDataRecord(context, resource.type, id);

    if (!record) {
        throw new NotFoundError('Record not found.', { code: 'AdminDataRecordNotFound' });
    }

    return respondWithJsonApi(response, 200, { data: serializeResource(context, record, fields) });
}

async function createRecord(context, request, response, resource) {
    const fields = parseFieldsQuery(request, resource);
    assertStrictJsonApiContentType(request);
    const document = await request.json();

    const form = AdminDataRecordForm.fromJsonApi(document, resource, 'create');
    form.validate();

    const record = await createAdminDataRecord(context, form);
    const data = serializeResource(context, record, fields);

    respondWithJsonApi(response, 201, { data }, {
        headers: { location: new URL(data.links.self, request.url.origin).href },
    });

    logMutationSuccess(context, 'create', resource.type, record.id);
    return response;
}

async function updateRecord(context, request, response, resource, id) {
    const fields = parseFieldsQuery(request, resource);
    assertStrictJsonApiContentType(request);
    const document = await request.json();

    const form = AdminDataRecordForm.fromJsonApi(document, resource, 'update', id);
    form.validate();

    const record = await updateAdminDataRecord(context, form);

    respondWithJsonApi(response, 200, { data: serializeResource(context, record, fields) });

    logMutationSuccess(context, 'update', resource.type, id);
    return response;
}

async function deleteRecord(context, request, response, resource, id) {
    assertNoQueryParameters(request);
    const version = readExpectedVersionHeader(request);

    await deleteAdminDataRecord(context, resource.type, id, version);

    response.respond(204);

    logMutationSuccess(context, 'delete', resource.type, id);
    return response;
}

// Resolves the registration and operation, then authorizes, before any query
// parameter or body is read: a token without the grant learns nothing about
// what a valid request would look like.
function selectOperation(context, request, type, operations) {
    const resource = adminDataResources.getResource(type);

    if (!resource) {
        throw new NotFoundError('Unknown resource type.', { code: 'AdminDataResourceTypeNotFound' });
    }

    const action = operations[request.method];

    if (!action || !adminDataResources.isOperationEnabled(type, action)) {
        const allowedMethods = Object.keys(operations).filter((method) => {
            return adminDataResources.isOperationEnabled(type, operations[method]);
        });

        throw new MethodNotAllowedError(
            `HTTP method ${ request.method } is not enabled for this resource.`,
            { code: 'AdminDataOperationNotEnabled', allowedMethods },
        );
    }

    authorizeAdminDataAction(context, type, action);

    return { resource, action };
}

// Log only identity and outcome; never bearer secrets or record attributes.
function logMutationSuccess(context, action, type, id) {
    context.logger.info('admin data mutation succeeded', {
        principal: context.user.id,
        requestId: context.requestId,
        action,
        type,
        id,
        outcome: 'succeeded',
    });
}
