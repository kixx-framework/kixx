import * as assertions from './assertions/mod.js';
import * as errors from './errors/mod.js';
import { ALPHA, OMEGA } from './lib/constants.js';
import * as fileSystem from './lib/file-system.js';
import deepMerge from './lib/deep-merge.js';
import { escapeHTMLChars } from './kixx-templating/mod.js';
import * as Hyperview from './hyperview/mod.js';
import { luxon } from './vendor/mod.js';

const { DateTime, Duration, Interval } = luxon;

const {
    AssertionError,
    isString,
    isNonEmptyString,
    isNumber,
    isNumberNotNaN,
    isBoolean,
    isUndefined,
    isPrimitive,
    isFunction,
    isPlainObject,
    isDate,
    isValidDate,
    isRegExp,
    isMap,
    isSet,
    isEqual,
    doesMatch,
    toFriendlyString,
    assert,
    assertFalsy,
    assertEqual,
    assertNotEqual,
    assertMatches,
    assertNotMatches,
    assertDefined,
    assertUndefined,
    assertNonEmptyString,
    assertNumberNotNaN,
    assertArray,
    assertBoolean,
    assertFunction,
    assertValidDate,
    assertRegExp,
    assertGreaterThan,
    assertLessThan,
} = assertions;

const {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    MethodNotAllowedError,
    NotAcceptableError,
    NotFoundError,
    NotImplementedError,
    OperationalError,
    UnauthenticatedError,
    UnauthorizedError,
    UnsupportedMediaTypeError,
    ValidationError,
    WrappedError,
} = errors;

export {
    // Unicode sentinel values for open-ended key range queries
    ALPHA,
    OMEGA,

    // Namespaces
    assertions,
    errors,
    fileSystem,

    // Helpers
    deepMerge,
    escapeHTMLChars,

    // Assertion helpers
    isString,
    isNonEmptyString,
    isNumber,
    isNumberNotNaN,
    isBoolean,
    isUndefined,
    isPrimitive,
    isFunction,
    isPlainObject,
    isDate,
    isValidDate,
    isRegExp,
    isMap,
    isSet,
    isEqual,
    doesMatch,
    toFriendlyString,

    // Assertions
    assert,
    assertFalsy,
    assertEqual,
    assertNotEqual,
    assertMatches,
    assertNotMatches,
    assertDefined,
    assertUndefined,
    assertNonEmptyString,
    assertNumberNotNaN,
    assertArray,
    assertBoolean,
    assertFunction,
    assertValidDate,
    assertRegExp,
    assertGreaterThan,
    assertLessThan,

    // Errors
    AssertionError,
    BadRequestError,
    ConflictError,
    ForbiddenError,
    MethodNotAllowedError,
    NotAcceptableError,
    NotFoundError,
    NotImplementedError,
    OperationalError,
    UnauthenticatedError,
    UnauthorizedError,
    UnsupportedMediaTypeError,
    ValidationError,
    WrappedError,

    // DateTime
    DateTime,
    Duration,
    Interval,

    Hyperview
};

