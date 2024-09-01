import { describe } from 'node:test';
import testIsString from './is-string.js';
import testIsNonEmptyString from './is-non-empty-string.js';
import testIsNumber from './is-number.js';
import testIsNumberNotNaN from './is-number-not-nan.js';
import testIsBoolean from './is-boolean.js';
import testIsUndefined from './is-undefined.js';
import testIsPrimitive from './is-primitive.js';
import testIsFunction from './is-function.js';
import testIsEqual from './is-equal.js';
import testAssert from './assert.js';
import testAssertFalsy from './assert-falsy.js';

describe('assertions', () => {
    describe('isString', testIsString);
    describe('isNonEmptyString', testIsNonEmptyString);
    describe('isNumber', testIsNumber);
    describe('isNumberNotNaN', testIsNumberNotNaN);
    describe('isBoolean', testIsBoolean);
    describe('isUndefined', testIsUndefined);
    describe('isPrimitive', testIsPrimitive);
    describe('isFunction', testIsFunction);
    describe('isEqual', testIsEqual);
    describe('assert', testAssert);
    describe('assertFalsy', testAssertFalsy);
});
