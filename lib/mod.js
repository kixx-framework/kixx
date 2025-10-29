import KixxBaseModel from './models/kixx-base-model.js';
import KixxBaseCollection from './models/kixx-base-collection.js';
import KixxBaseForm from './models/kixx-base-form.js';
import KixxBaseView from './models/kixx-base-view.js';
import KixxBaseUser from './user/kixx-base-user.js';
import KixxBaseUserSession from './user/kixx-base-user-session.js';
import KixxBaseUserCollection from './user/kixx-base-user.collection.js';
import * as assertions from './assertions/mod.js';
import * as errors from './errors/mod.js';
import { ALPHA, OMEGA } from './lib/constants.js';
import * as fileSystem from './lib/file-system.js';
import deepMerge from './lib/deep-merge.js';
import { escapeHTMLChars } from './template-engine/mod.js';
import formatDate from './view-service/helpers/format-date.js';
import plusOne from './view-service/helpers/plus-one.js';
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

const templateHelpers = {
    formatDate,
    plusOne,
};

export {
    // Unicode sentinel values for open-ended key range queries
    ALPHA,
    OMEGA,

    // Namespaces
    assertions,
    errors,
    fileSystem,

    // Models
    KixxBaseModel,
    KixxBaseCollection,
    KixxBaseForm,
    KixxBaseView,
    KixxBaseUser,
    KixxBaseUserSession,
    KixxBaseUserCollection,

    // Helpers
    deepMerge,
    escapeHTMLChars,

    // Template helpers
    templateHelpers,

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
    Interval
};

