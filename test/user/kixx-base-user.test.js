import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import KixxBaseUser from '../../lib/user/kixx-base-user.js';

describe('KixxBaseUser#hasPermission() when there are 1 or more matches', ({ before, after, it }) => {
    let context;
    let user;
    const regex1 = /^kixx:view:admin:/;
    const regex2 = /^kixx:form:user:/;
    let result;

    before(() => {
        context = {};

        sinon.spy(regex1, 'test');
        sinon.spy(regex2, 'test');

        const roles = [
            {
                name: 'admin',
                permissions: [
                    { regex: regex1 },
                    { regex: regex2 },
                ],
            },
        ];

        user = new KixxBaseUser(context, { id: '123', name: 'Test User' }, roles);
        result = user.hasPermission('kixx:view:admin:getItem');
    });

    after(() => {
        sinon.restore();
    });

    it('calls the test() method of each permission', () => {
        assertEqual(1, regex1.test.callCount, 'regex1.test() was called once');
        // regex2.test() should not be called because regex1 matched first
        assertEqual(0, regex2.test.callCount, 'regex2.test() was not called');
    });

    it('returns true', () => {
        assertEqual(true, result, 'hasPermission() returns true');
    });
});

describe('KixxBaseUser#hasPermission() when there are no matches', ({ before, after, it }) => {
    let context;
    let user;
    const regex1 = /^kixx:view:admin:/;
    const regex2 = /^kixx:form:user:/;
    let result;

    before(() => {
        context = {};

        sinon.spy(regex1, 'test');
        sinon.spy(regex2, 'test');

        const roles = [
            {
                name: 'admin',
                permissions: [
                    { regex: regex1 },
                    { regex: regex2 },
                ],
            },
        ];

        user = new KixxBaseUser(context, { id: '123', name: 'Test User' }, roles);
        result = user.hasPermission('kixx:view:public:getItem');
    });

    after(() => {
        sinon.restore();
    });

    it('calls the test() method of each permission', () => {
        assertEqual(1, regex1.test.callCount, 'regex1.test() was called once');
        assertEqual(1, regex2.test.callCount, 'regex2.test() was called once');
    });

    it('returns false', () => {
        assertEqual(false, result, 'hasPermission() returns false');
    });
});
