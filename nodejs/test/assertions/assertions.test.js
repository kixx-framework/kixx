import { describe } from 'node:test';
import testIsString from './is-string.js';
import testIsNonEmptyString from './is-non-empty-string.js';
import testIsNumber from './is-number.js';
import testIsNumberNotNaN from './is-number-not-nan.js';
import testIsBoolean from './is-boolean.js';
import testIsUndefined from './is-undefined.js';
import testIsPrimitive from './is-primitive.js';
import testIsFunction from './is-function.js';
import testIsPlainObject from './is-plain-object.js';
import testIsDate from './is-date.js';
import testIsValidDate from './is-valid-date.js';
import testIsRegExp from './is-reg-exp.js';
import testIsMap from './is-map.js';
import testIsSet from './is-set.js';
import testIsEqual from './is-equal.js';
import testDoesMatch from './does-match.js';
import testToFriendlyString from './to-friendly-string.js';
import testCurryAssertion2 from './curry-assertion-2.js';
import testAssert from './assert.js';
import testAssertFalsy from './assert-falsy.js';
import testAssertEqual from './assert-equal.js';
import testAssertNotEqual from './assert-not-equal.js';
import testAssertMatches from './assert-matches.js';
import testAssertNotMatches from './assert-not-matches.js';
import testAssertDefined from './assert-defined.js';
import testAssertUndefined from './assert-undefined.js';
import testAssertNonEmptyString from './assert-non-empty-string.js';
import testAssertNumberNotNaN from './assert-number-not-nan.js';
import testAssertArray from './assert-array.js';
import testAssertBoolean from './assert-boolean.js';
import testAssertFunction from './assert-function.js';
import testAssertValidDate from './assert-valid-date.js';


describe('assertions', () => {
    describe('isString', testIsString);
    describe('isNonEmptyString', testIsNonEmptyString);
    describe('isNumber', testIsNumber);
    describe('isNumberNotNaN', testIsNumberNotNaN);
    describe('isBoolean', testIsBoolean);
    describe('isUndefined', testIsUndefined);
    describe('isPrimitive', testIsPrimitive);
    describe('isFunction', testIsFunction);
    describe('isPlainObject', testIsPlainObject);
    describe('isDate', testIsDate);
    describe('isValidDate', testIsValidDate);
    describe('isRegExp', testIsRegExp);
    describe('isMap', testIsMap);
    describe('isSet', testIsSet);
    describe('isEqual', testIsEqual);
    describe('doesMatch', testDoesMatch);
    describe('toFriendlyString', testToFriendlyString);
    describe('curryAssertion2', testCurryAssertion2);
    describe('assert', testAssert);
    describe('assertFalsy', testAssertFalsy);
    describe('assertEqual', testAssertEqual);
    describe('assertNotEqual', testAssertNotEqual);
    describe('assertMatches', testAssertMatches);
    describe('assertNotMatches', testAssertNotMatches);
    describe('assertDefined', testAssertDefined);
    describe('assertUndefined', testAssertUndefined);
    describe('assertNonEmptyString', testAssertNonEmptyString);
    describe('assertNumberNotNaN', testAssertNumberNotNaN);
    describe('assertArray', testAssertArray);
    describe('assertBoolean', testAssertBoolean);
    describe('assertFunction', testAssertFunction);
    describe('assertValidDate', testAssertValidDate);
});
