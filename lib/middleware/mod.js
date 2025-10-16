import CookieAuthentication from './cookie-authentication.js';
import { assertFunction, assertNonEmptyString } from '../assertions/mod.js';

export const middleware = new Map();

middleware.set('kixx.CookieAuthentication', CookieAuthentication);

export function registerMiddleware(name, middlewareFunction) {
    assertNonEmptyString(name, 'A middleware name is required');
    assertFunction(middlewareFunction, 'The middleware must be a function');

    middleware.set(name, middlewareFunction);
}
