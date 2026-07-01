import { HyperviewDynamicPageHandler } from '../../../kixx/hyperview/hyperview-request-handlers.js';
import { assertNonEmptyString, isNonEmptyString, isNumberNotNaN } from '../../../kixx/assertions/mod.js';


const UNEXPECTED_ERROR_PAGE = {
    statusCode: 500,
    heading: 'Something went wrong',
    message: 'Something went wrong while loading this page.',
    classification: 'error',
};

const STATUS_HEADINGS = {
    400: 'Bad request',
    401: 'Authentication required',
    403: 'Access denied',
    404: 'Page not found',
    405: 'Method not allowed',
    406: 'Not acceptable',
    409: 'Conflict',
    412: 'Precondition failed',
    413: 'Payload too large',
    415: 'Unsupported media type',
    422: 'Validation failed',
    500: UNEXPECTED_ERROR_PAGE.heading,
    501: 'Not implemented',
};


/**
 * Renders a fixed-pathname Hyperview error page for HTML requests.
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current server request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Mutable server response.
 * @param {Error} error - Error being handled by the router cascade.
 * @param {string} pathname - Fixed Hyperview pathname for the error page template.
 * @param {string} [scope] - Optional scope label appended to the page title, e.g. `'Admin'`.
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default>|false} Rendered response, or false for JSON requests.
 */
export function renderHtmlErrorPage(context, request, response, error, pathname, scope) {
    assertNonEmptyString(pathname, 'renderHtmlErrorPage: pathname');

    if (request.isJSONRequest()) {
        return false;
    }

    const {
        statusCode,
        heading,
        message,
        classification,
    } = classifyError(error);

    response.status = statusCode;
    setErrorHeaders(response, error, statusCode);
    response.updateProps({
        page: {
            title: isNonEmptyString(scope) ? `${ heading } : ${ scope }` : heading,
        },
        error: {
            statusCode,
            heading,
            message,
            classification,
        },
    });

    return HyperviewDynamicPageHandler({ pathname, allowJSON: false })(context, request, response);
}


function classifyError(error) {
    if (error?.httpError && isNumberNotNaN(error.httpStatusCode)) {
        const statusCode = Number(error.httpStatusCode);
        const isClientError = statusCode >= 100 && statusCode <= 499;

        return {
            statusCode,
            heading: getHeading(statusCode, error),
            message: isClientError && isNonEmptyString(error.message)
                ? error.message
                : UNEXPECTED_ERROR_PAGE.message,
            classification: statusCode >= 500 ? 'error' : 'warning',
        };
    }

    return UNEXPECTED_ERROR_PAGE;
}

function getHeading(statusCode, error) {
    if (STATUS_HEADINGS[statusCode]) {
        return STATUS_HEADINGS[statusCode];
    }

    if (isNonEmptyString(error?.name)) {
        return error.name.replace(/Error$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
    }

    return `${ statusCode } error`;
}

function setErrorHeaders(response, error, statusCode) {
    if (statusCode === 405 && Array.isArray(error?.allowedMethods)) {
        response.setHeader('allow', error.allowedMethods.join(', '));
    }
}
