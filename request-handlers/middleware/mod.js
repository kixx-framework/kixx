import { assertFunction, assertNonEmptyString } from '../../assertions/mod.js';

export const middleware = new Map();

export function registerMiddleware(name, handler) {
    assertNonEmptyString(name, 'A middleware name is required');
    assertFunction(handler, 'The middleware must be a function');

    middleware.set(name, handler);
}
