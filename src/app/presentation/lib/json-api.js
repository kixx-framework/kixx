import {
    assertNonEmptyString,
    isNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../../../kixx/assertions/mod.js';
import {
    BadRequestError,
    ConflictError,
    NotAcceptableError,
    UnauthenticatedError,
    UnsupportedMediaTypeError,
} from '../../../kixx/errors/mod.js';


export const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';

// JSON:API 1.1 allows only these media type parameters. No extensions are
// supported, so `ext` is still rejected; `profile` may be ignored. `q` is an
// Accept weight, not a media type parameter.
const ALLOWED_CONTENT_TYPE_PARAMETERS = new Set([ 'profile' ]);
const ALLOWED_ACCEPT_PARAMETERS = new Set([ 'profile', 'q' ]);


/**
 * Parses HTTP Basic credentials from an Authorization header.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @returns {{ username: string, password: string }} Decoded username and password.
 * @throws {UnauthenticatedError} When the Authorization header is absent or malformed.
 */
export function parseBasicAuthCredentials(request) {
    const authorization = request.headers.get('authorization')?.trim();
    const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);

    if (!match) {
        throw new UnauthenticatedError('HTTP Basic credentials are required.');
    }

    let credentials;
    try {
        credentials = new TextDecoder().decode(Uint8Array.from(
            atob(match[1]),
            (character) => character.charCodeAt(0),
        ));
    } catch (cause) {
        throw new UnauthenticatedError('HTTP Basic credentials are malformed.', { cause });
    }

    const separatorIndex = credentials.indexOf(':');
    if (separatorIndex < 1 || separatorIndex === credentials.length - 1) {
        throw new UnauthenticatedError('HTTP Basic credentials are malformed.');
    }

    return {
        username: credentials.slice(0, separatorIndex),
        password: credentials.slice(separatorIndex + 1),
    };
}


/**
 * Verifies that the request body is a JSON:API document.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @returns {void}
 * @throws {UnsupportedMediaTypeError} When the request payload is not JSON:API.
 */
export function assertJsonApiContentType(request) {
    const contentType = request.getContentMediaType();

    if (contentType !== JSON_API_CONTENT_TYPE) {
        throw new UnsupportedMediaTypeError(
            `Request Content-Type must be ${ JSON_API_CONTENT_TYPE }.`,
            { accept: [ JSON_API_CONTENT_TYPE ] },
        );
    }
}

/**
 * Parses a JSON:API resource document and returns the resource id and attributes.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {string} expectedType - JSON:API resource type required by the endpoint.
 * @returns {Promise<{ id: string|undefined, attributes: Object }>} Parsed resource values.
 * @throws {BadRequestError} When the JSON:API envelope is malformed.
 * @throws {ConflictError} When the resource type does not match `expectedType`.
 */
export async function parseJsonApiResource(request, expectedType) {
    assertNonEmptyString(expectedType, 'parseJsonApiResource: expectedType');

    const document = await request.json();

    if (!isPlainObject(document) || !isPlainObject(document.data)) {
        throw new BadRequestError('JSON:API request body must contain a data object.');
    }

    const { data } = document;

    if (!isNonEmptyString(data.type)) {
        throw new BadRequestError('JSON:API resource data.type must be a non-empty string.');
    }

    if (data.type !== expectedType) {
        throw new ConflictError(
            `JSON:API resource type must be ${ expectedType }.`,
            { code: 'JsonApiResourceTypeMismatch' },
        );
    }

    if (!isPlainObject(data.attributes)) {
        throw new BadRequestError('JSON:API resource data.attributes must be an object.');
    }

    return {
        id: data.id,
        attributes: data.attributes,
    };
}

/**
 * Builds a JSON:API resource document for response serialization.
 * @param {Object} args - Resource document values.
 * @param {string} args.type - JSON:API resource type.
 * @param {string} [args.id] - JSON:API resource id.
 * @param {Object} args.attributes - JSON:API resource attributes.
 * @param {Object} [args.meta] - Optional JSON:API resource-level metadata.
 * @returns {{ data: { type: string, id?: string, attributes: Object, meta?: Object } }} JSON:API document.
 */
export function jsonApiResource(args) {
    const {
        type,
        id,
        attributes,
        meta,
    } = args ?? {};

    const data = { type, attributes };

    if (!isUndefined(id)) {
        data.id = id;
    }

    if (!isUndefined(meta)) {
        data.meta = meta;
    }

    return { data };
}

/**
 * Verifies a JSON:API request body media type as JSON:API 1.1 requires.
 *
 * Stricter than assertJsonApiContentType(), which ignores parameters: any
 * parameter other than `profile`, including `charset` and `ext`, is rejected.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @returns {void}
 * @throws {UnsupportedMediaTypeError} With `source.header` when the Content-Type is not acceptable JSON:API.
 */
export function assertStrictJsonApiContentType(request) {
    const mediaType = parseMediaType(request.headers.get('content-type') ?? '');

    const isAcceptable = mediaType.type === JSON_API_CONTENT_TYPE
        && mediaType.parameters.every((name) => ALLOWED_CONTENT_TYPE_PARAMETERS.has(name));

    if (!isAcceptable) {
        throw withErrorSource(new UnsupportedMediaTypeError(
            `Request Content-Type must be ${ JSON_API_CONTENT_TYPE } without media type parameters.`,
            { accept: [ JSON_API_CONTENT_TYPE ] },
        ), { header: 'Content-Type' });
    }
}

/**
 * Applies JSON:API 1.1 response negotiation to the Accept header.
 *
 * Only Accept entries naming the JSON:API media type are considered. When
 * there are some and every one carries an unsupported parameter, the client
 * cannot accept any response this server sends. An absent Accept header, or
 * one without the JSON:API media type, is left to the client.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @returns {void}
 * @throws {NotAcceptableError} With `source.header` when no JSON:API Accept entry is acceptable.
 */
export function assertAcceptsJsonApi(request) {
    const accept = request.headers.get('accept');

    if (!accept) {
        return;
    }

    const entries = accept.split(',')
        .map(parseMediaType)
        .filter(({ type }) => type === JSON_API_CONTENT_TYPE);

    const hasAcceptableEntry = entries.some(({ parameters }) => {
        return parameters.every((name) => ALLOWED_ACCEPT_PARAMETERS.has(name));
    });

    if (entries.length > 0 && !hasAcceptableEntry) {
        throw withErrorSource(new NotAcceptableError(
            `Accept must allow ${ JSON_API_CONTENT_TYPE } without media type parameters.`,
            { accept: [ JSON_API_CONTENT_TYPE ] },
        ), { header: 'Accept' });
    }
}

/**
 * Attaches a JSON:API error source to an error before it is thrown.
 * @param {Error} error - Error to annotate; mutated.
 * @param {{ pointer?: string, parameter?: string, header?: string }} source - JSON:API error source object.
 * @returns {Error} The same error, for `throw withErrorSource(...)`.
 */
export function withErrorSource(error, source) {
    error.source = source;
    return error;
}

/**
 * Converts an expected HTTP error into JSON:API 1.1 error objects.
 *
 * A multi-entry error such as ValidationError produces one object per entry.
 * A string source is a Record or Form field path such as `content.key` and
 * becomes a pointer into `/data/attributes`; an object source is used as is.
 * Only the error's public message is exposed, never its cause.
 * @param {Error} error - Expected error carrying `httpStatusCode`.
 * @returns {Object[]} JSON:API error objects with `status`, `code`, `title`, `detail`, and optional `source`.
 */
export function toJsonApiErrorObjects(error) {
    const base = {
        status: String(error.httpStatusCode),
        code: error.code,
        title: error.name,
    };

    const entries = Array.isArray(error.errors) && error.errors.length > 0
        ? error.errors
        : [ error ];

    return entries.map((entry) => {
        const errorObject = Object.assign({}, base, { detail: entry.message });
        const source = toJsonApiErrorSource(entry.source);

        if (source) {
            errorObject.source = source;
        }

        return errorObject;
    });
}

/**
 * Writes a JSON:API document with the exact JSON:API Content-Type.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Response to populate.
 * @param {number} statusCode - HTTP status code.
 * @param {Object} document - JSON:API top-level document.
 * @param {Object} [options] - respondWithJSON() options such as `headers`.
 * @returns {import('../../../kixx/http-router/server-response.js').default} The populated response.
 */
export function respondWithJsonApi(response, statusCode, document, options) {
    response.respondWithJSON(statusCode, document, Object.assign({}, options, {
        contentType: JSON_API_CONTENT_TYPE,
    }));

    // respondWithJSON() always appends `charset=utf-8`, but JSON:API 1.1
    // forbids media type parameters other than ext and profile on responses.
    response.setHeader('content-type', JSON_API_CONTENT_TYPE);

    return response;
}

function parseMediaType(value) {
    const [ type, ...parameters ] = value.split(';');

    return {
        type: type.trim().toLowerCase(),
        parameters: parameters
            .map((parameter) => parameter.split('=')[0].trim().toLowerCase())
            .filter(Boolean),
    };
}

function toJsonApiErrorSource(source) {
    if (isPlainObject(source)) {
        return Object.assign({}, source);
    }

    if (isNonEmptyString(source)) {
        // RFC 6901: escape "~" before "/" so an escaped "/" is not re-escaped.
        const segments = source.split('.').map((segment) => {
            return segment.replaceAll('~', '~0').replaceAll('/', '~1');
        });
        return { pointer: `/data/attributes/${ segments.join('/') }` };
    }

    return null;
}
