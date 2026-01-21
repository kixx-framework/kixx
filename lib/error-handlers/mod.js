// TODO: Remove this file
import ErrorHandler from './error-handler.js';
import { assertFunction, assertNonEmptyString } from '../assertions/mod.js';

export const errorHandlers = new Map();

errorHandlers.set('kixx.ErrorHandler', ErrorHandler);

export function registerErrorHandler(name, handler) {
    assertNonEmptyString(name, 'A handler name is required');
    assertFunction(handler, 'The handler must be a function');

    errorHandlers.set(name, handler);
}
