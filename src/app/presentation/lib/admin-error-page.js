import { HyperviewDynamicPageHandler } from '../../../kixx/hyperview/hyperview-request-handlers.js';
import { assertNonEmptyString, isNonEmptyString, isNumberNotNaN } from '../../../kixx/assertions/mod.js';


const UNEXPECTED_ERROR_PAGE = {
    statusCode: 500,
    heading: 'Something went wrong',
    message: 'Something went wrong while loading this admin page.',
    calloutClass: 'callout callout--error',
    calloutIcon: 'error',
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
 * Renders a fixed admin-scope Hyperview error page for HTML requests.
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current server request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Mutable server response.
 * @param {Error} error - Error being handled by the router cascade.
 * @param {string} pathname - Fixed Hyperview pathname for the visual scope.
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default>|false} Rendered response, or false for JSON requests.
 */
export function renderAdminErrorPage(context, request, response, error, pathname) {
    assertNonEmptyString(pathname, 'renderAdminErrorPage: pathname');

    if (request.isJSONRequest()) {
        return false;
    }

    const {
        statusCode,
        heading,
        message,
        calloutClass,
        calloutIcon,
    } = classifyError(error);

    response.status = statusCode;
    setErrorHeaders(response, error, statusCode);
    response.updateProps({
        page: {
            title: `${ heading } : Admin`,
        },
        error: {
            statusCode,
            heading,
            message,
            calloutClass,
            calloutIcon,
        },
    });

    return HyperviewDynamicPageHandler({ pathname, allowJSON: false })(context, request, response);
}


function classifyError(error) {
    if (error?.httpError && isHttpStatusCode(error.httpStatusCode)) {
        const statusCode = Number(error.httpStatusCode);
        const isClientError = statusCode >= 100 && statusCode <= 499;

        return {
            statusCode,
            heading: getHeading(statusCode, error),
            message: isClientError && isNonEmptyString(error.message)
                ? error.message
                : UNEXPECTED_ERROR_PAGE.message,
            calloutClass: statusCode >= 500
                ? 'callout callout--error'
                : 'callout callout--warning',
            calloutIcon: statusCode >= 500 ? 'error' : 'warning',
        };
    }

    return UNEXPECTED_ERROR_PAGE;
}

function isHttpStatusCode(statusCode) {
    const value = Number(statusCode);
    return isNumberNotNaN(value) &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 599;
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
