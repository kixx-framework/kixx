import PageErrorHandler from './page-error-handler.js';
import { assertFunction, assertNonEmptyString } from '../../assertions/mod.js';

export const errorHandlers = new Map();

errorHandlers.set('kixx.PageErrorHandler', PageErrorHandler);

errorHandlers.set('kixx.AppPageErrorHandler', function AppPageErrorHandler(options) {
    const opts = Object.assign({ viewService: 'kixx.AppViewService' }, options || {});
    // eslint-disable-next-line new-cap
    return PageErrorHandler(opts);
});

export function registerErrorHandler(name, handler) {
    assertNonEmptyString(name, 'A handler name is required');
    assertFunction(handler, 'The handler must be a function');

    errorHandlers.set(name, handler);
}
