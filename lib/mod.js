import * as assertions from './assertions/mod.js';
import * as errors from './errors/mod.js';
import { luxon } from '../../vendor/mod.js';

const DatesAndTimes = luxon;
const { DateTime, Duration, Interval } = luxon;

globalThis.AssertionError = assertions.AssertionError;
globalThis.isString = assertions.isString;
globalThis.isNonEmptyString = assertions.isNonEmptyString;
globalThis.isNumber = assertions.isNumber;
globalThis.isNumberNotNaN = assertions.isNumberNotNaN;
globalThis.isBoolean = assertions.isBoolean;
globalThis.isUndefined = assertions.isUndefined;
globalThis.isPrimitive = assertions.isPrimitive;
globalThis.isFunction = assertions.isFunction;
globalThis.isPlainObject = assertions.isPlainObject;
globalThis.isDate = assertions.isDate;
globalThis.isValidDate = assertions.isValidDate;
globalThis.isRegExp = assertions.isRegExp;
globalThis.isMap = assertions.isMap;
globalThis.isSet = assertions.isSet;
globalThis.isEqual = assertions.isEqual;
globalThis.doesMatch = assertions.doesMatch;
globalThis.toFriendlyString = assertions.toFriendlyString;
globalThis.assert = assertions.assert;
globalThis.assertFalsy = assertions.assertFalsy;
globalThis.assertEqual = assertions.assertEqual;
globalThis.assertNotEqual = assertions.assertNotEqual;
globalThis.assertMatches = assertions.assertMatches;
globalThis.assertNotMatches = assertions.assertNotMatches;
globalThis.assertDefined = assertions.assertDefined;
globalThis.assertUndefined = assertions.assertUndefined;
globalThis.assertNonEmptyString = assertions.assertNonEmptyString;
globalThis.assertNumberNotNaN = assertions.assertNumberNotNaN;
globalThis.assertArray = assertions.assertArray;
globalThis.assertBoolean = assertions.assertBoolean;
globalThis.assertFunction = assertions.assertFunction;
globalThis.assertValidDate = assertions.assertValidDate;
globalThis.assertRegExp = assertions.assertRegExp;
globalThis.assertGreaterThan = assertions.assertGreaterThan;
globalThis.assertLessThan = assertions.assertLessThan;

globalThis.BadRequestError = errors.BadRequestError;
globalThis.ConflictError = errors.ConflictError;
globalThis.ForbiddenError = errors.ForbiddenError;
globalThis.MethodNotAllowedError = errors.MethodNotAllowedError;
globalThis.NotAcceptableError = errors.NotAcceptableError;
globalThis.NotFoundError = errors.NotFoundError;
globalThis.NotImplementedError = errors.NotImplementedError;
globalThis.OperationalError = errors.OperationalError;
globalThis.UnauthenticatedError = errors.UnauthenticatedError;
globalThis.UnauthorizedError = errors.UnauthorizedError;
globalThis.UnsupportedMediaTypeError = errors.UnsupportedMediaTypeError;
globalThis.ValidationError = errors.ValidationError;
globalThis.WrappedError = errors.WrappedError;

export {
    assertions,
    errors,
    DatesAndTimes,
    DateTime,
    Duration,
    Interval
};

