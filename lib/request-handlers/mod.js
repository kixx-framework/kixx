import PageHandler from './page-handler.js';
import QueryView from './query-view.js';
import StaticFileServer from './static-file-server.js';
import { assertFunction, assertNonEmptyString } from '../assertions/mod.js';

export const handlers = new Map();

handlers.set('kixx.PageHandler', PageHandler);
handlers.set('kixx.QueryView', QueryView);
handlers.set('kixx.StaticFileServer', StaticFileServer);

export function registerHandler(name, handler) {
    assertNonEmptyString(name, 'A handler name is required');
    assertFunction(handler, 'The handler must be a function');

    handlers.set(name, handler);
}
