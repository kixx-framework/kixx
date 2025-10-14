import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
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

describe('KixxBaseUser#toRecord()', ({ before, it }) => {
    let context;
    let user;
    let roles;
    let record;

    before(() => {
        context = { name: 'TestContext' };

        roles = [
            {
                name: 'admin',
                permissions: [
                    { regex: /^kixx:view:admin:/ },
                ],
            },
            {
                name: 'editor',
                permissions: [
                    { regex: /^kixx:form:user:/ },
                ],
            },
        ];

        user = new KixxBaseUser(
            context,
            {
                id: '123',
                name: 'Test User',
                email: 'test@example.com',
            },
            roles
        );

        record = user.toRecord();
    });

    it('returns a shallow copy of the user', () => {
        assert(record !== user, 'record is not the same reference as user');
        assertEqual('object', typeof record, 'record is an object');
    });

    it('maps the roles array to an array of strings', () => {
        assertEqual(true, Array.isArray(record.roles), 'record.roles is an array');
        assertEqual(2, record.roles.length, 'record.roles has 2 elements');
        assertEqual('admin', record.roles[0], 'first role is "admin"');
        assertEqual('editor', record.roles[1], 'second role is "editor"');
    });

    it('maps all other properties without modification', () => {
        assertEqual('123', record.id, 'id is copied');
        assertEqual('Test User', record.name, 'name is copied');
        assertEqual('test@example.com', record.email, 'email is copied');
        assertEqual('KixxBaseUser', record.type, 'type is copied');
        assertEqual(false, record.isAnonymous, 'isAnonymous is copied');
    });

    it('only maps enumerable properties to the returned object', () => {
        assertEqual(undefined, record.context, 'context is not copied (non-enumerable)');
    });
});

describe('KixxBaseUser.create()', ({ before, after, it }) => {
    let context;
    let props;
    let roles;
    let genIdStub;
    let user;

    before(() => {
        context = { name: 'TestContext' };

        props = {
            name: 'Test User',
            email: 'test@example.com',
        };

        roles = [
            {
                name: 'admin',
                permissions: [
                    { regex: /^kixx:view:admin:/ },
                ],
            },
        ];

        genIdStub = sinon.stub(KixxBaseUser, 'genId').returns('generated-id-123');

        user = KixxBaseUser.create(context, props, roles);
    });

    after(() => {
        sinon.restore();
    });

    it('calls genId() to generate an ID', () => {
        assertEqual(1, genIdStub.callCount, 'genId() was called once');
    });

    it('returns an instance of KixxBaseUser', () => {
        assertEqual(true, user instanceof KixxBaseUser, 'user is an instance of KixxBaseUser');
        assertEqual('KixxBaseUser', user.type, 'user type is KixxBaseUser');
    });

    it('assigns the generated ID to the user', () => {
        assertEqual('generated-id-123', user.id, 'user.id is the generated ID');
    });

    it('assigns all props to the user', () => {
        assertEqual('Test User', user.name, 'user.name is assigned');
        assertEqual('test@example.com', user.email, 'user.email is assigned');
    });

    it('assigns the context to the user', () => {
        assertEqual(context, user.context, 'user.context is assigned');
    });

    it('assigns the roles to the user', () => {
        assertEqual(roles, user.roles, 'user.roles is assigned');
        assertEqual(1, user.roles.length, 'user has 1 role');
        assertEqual('admin', user.roles[0].name, 'first role is admin');
    });
});

describe('KixxBaseUser.create() with existing id in props', ({ before, after, it }) => {
    let context;
    let props;
    let roles;
    let user;

    before(() => {
        context = { name: 'TestContext' };

        props = {
            id: 'existing-id-456',
            name: 'Test User',
        };

        roles = [];

        sinon.stub(KixxBaseUser, 'genId').returns('generated-id-789');

        user = KixxBaseUser.create(context, props, roles);
    });

    after(() => {
        sinon.restore();
    });

    it('uses the provided id', () => {
        assertEqual('existing-id-456', user.id, 'user.id is the generated ID, not the existing one');
    });
});
