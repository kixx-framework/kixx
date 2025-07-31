import PageHandler from './page-handler.js';
import StaticFileServer from './static-file-server.js';
import { assertFunction, assertNonEmptyString } from '../../assertions/mod.js';

export const handlers = new Map();

handlers.set('kixx.PageHandler', PageHandler);
handlers.set('kixx.StaticFileServer', StaticFileServer);

handlers.set('kixx.AppPageHandler', function AppPageHandler(options) {
    const opts = Object.assign({ viewService: 'kixx.AppViewService' }, options || {});
    // eslint-disable-next-line new-cap
    return PageHandler(opts);
});

export function registerHandler(name, handler) {
    assertNonEmptyString(name, 'A handler name is required');
    assertFunction(handler, 'The handler must be a function');

    handlers.set(name, handler);
}
