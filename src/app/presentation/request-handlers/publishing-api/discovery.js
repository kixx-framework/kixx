import { FORMAT } from '../../../../kixx/content-addressable-store/addressing.js';
import { CONTENT_CONTRACT_VERSION } from '../../../../kixx/content-addressable-store/content-addressable-store.js';
import { JSON_API_CONTENT_TYPE, jsonApiResource } from '../../lib/json-api.js';
import {
    BUILD_ASSIGNMENT_PROTOCOL_VERSION,
    MAX_MANIFEST_ENTRIES,
    MAX_OBJECT_BYTES,
    MAX_OBJECT_STATUS_IDS,
} from './constants.js';


/**
 * Describes the running Publishing API contract and enforced limits.
 * @param {Object} context - Active request context.
 * @param {Object} _request - Incoming request.
 * @param {Object} response - Response to populate.
 * @returns {Object} JSON:API discovery response.
 */
export function getDiscovery(context, _request, response) {
    const document = jsonApiResource({
        type: 'PublishingApi',
        id: 'v1',
        attributes: {
            runningBuildId: context.runtime.build.id ?? null,
            buildAssignmentProtocolVersion: BUILD_ASSIGNMENT_PROTOCOL_VERSION,
            contentContractVersion: CONTENT_CONTRACT_VERSION,
            addressingFormat: FORMAT,
            limits: {
                maxObjectBytes: MAX_OBJECT_BYTES,
                maxObjectStatusIds: MAX_OBJECT_STATUS_IDS,
                maxManifestEntries: MAX_MANIFEST_ENTRIES,
            },
        },
    });
    return response.respondWithJSON(200, document, { contentType: JSON_API_CONTENT_TYPE });
}
