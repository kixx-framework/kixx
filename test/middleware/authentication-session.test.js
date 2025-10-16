import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { AuthenticationSession } from '../../lib/middleware/cookie-authentication.js';

describe('AuthenticationSession constructor: with default values', ({ before, it }) => {

    const options = {};
    const config = {};

    let now;
    let authSession;

    before(() => {
        now = new Date();
        authSession = new AuthenticationSession(options, config);
    });

    it('sets default refreshWindowStartSeconds', () => {
        assertEqual(900, authSession.refreshWindowStartSeconds);
    });

    it('sets default refreshWindowEndSeconds', () => {
        assertEqual(1555200, authSession.refreshWindowEndSeconds);
    });

    it('sets default expirationWindowSeconds', () => {
        assertEqual(7776000, authSession.expirationWindowSeconds);
    });

    it('sets currentDateTime', () => {
        assert(now.getTime() >= (authSession.currentDateTime.getTime() - 1));
        assert(now.getTime() <= authSession.currentDateTime.getTime());
    });
});

describe('AuthenticationSession constructor: config overrides defaults', ({ before, it }) => {

    const options = {};
    const config = {
        refreshWindowStartSeconds: 120,
        refreshWindowEndSeconds: 3600,
        expirationWindowSeconds: 7200,
    };

    let authSession;

    before(() => {
        authSession = new AuthenticationSession(options, config);
    });

    it('uses config refreshWindowStartSeconds', () => {
        assertEqual(120, authSession.refreshWindowStartSeconds);
    });

    it('uses config refreshWindowEndSeconds', () => {
        assertEqual(3600, authSession.refreshWindowEndSeconds);
    });

    it('uses config expirationWindowSeconds', () => {
        assertEqual(7200, authSession.expirationWindowSeconds);
    });
});

describe('AuthenticationSession constructor: options override config and defaults', ({ before, it }) => {

    const options = {
        refreshWindowStartSeconds: 60,
        refreshWindowEndSeconds: 1800,
        expirationWindowSeconds: 3600,
    };
    const config = {
        refreshWindowStartSeconds: 120,
        refreshWindowEndSeconds: 3600,
        expirationWindowSeconds: 7200,
    };

    let authSession;

    before(() => {
        authSession = new AuthenticationSession(options, config);
    });

    it('uses options refreshWindowStartSeconds', () => {
        assertEqual(60, authSession.refreshWindowStartSeconds);
    });

    it('uses options refreshWindowEndSeconds', () => {
        assertEqual(1800, authSession.refreshWindowEndSeconds);
    });

    it('uses options expirationWindowSeconds', () => {
        assertEqual(3600, authSession.expirationWindowSeconds);
    });
});

describe('AuthenticationSession constructor: throws when both expiration windows are zero', ({ before, it }) => {

    const options = {
        expirationWindowSeconds: 0,
        refreshWindowEndSeconds: 0,
    };
    const config = {};

    let error;

    before(() => {
        try {
            new AuthenticationSession(options, config);
        } catch (err) {
            error = err;
        }
    });

    it('throws an AssertionError', () => {
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('AuthenticationSession constructor: throws when refreshWindowStartSeconds > refreshWindowEndSeconds', ({ before, it }) => {

    const options = {
        refreshWindowStartSeconds: 3600,
        refreshWindowEndSeconds: 1800,
    };
    const config = {};

    let error;

    before(() => {
        try {
            new AuthenticationSession(options, config);
        } catch (err) {
            error = err;
        }
    });

    it('throws an AssertionError', () => {
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('AuthenticationSession.isSessionExpired(): session expired via expirationWindowSeconds', ({ before, it }) => {

    const options = {
        expirationWindowSeconds: 60,
        refreshWindowEndSeconds: 60,
        refreshWindowStartSeconds: 10,
    };
    const config = {};

    const session = {
        creationDateTime: new Date(Date.now() - (120 * 1000)), // 2 minutes ago
        lastRefreshDateTime: new Date(Date.now() - (120 * 1000)),
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.isSessionExpired(session);
    });

    it('returns true', () => {
        assertEqual(true, result);
    });
});

describe('AuthenticationSession.isSessionExpired(): session expired via refreshWindowEndSeconds', ({ before, it }) => {

    const options = {
        expirationWindowSeconds: 0,
        refreshWindowStartSeconds: 30,
        refreshWindowEndSeconds: 60,
    };
    const config = {};

    const session = {
        creationDateTime: new Date(Date.now() - (30 * 1000)),
        lastRefreshDateTime: new Date(Date.now() - (120 * 1000)), // 2 minutes ago
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.isSessionExpired(session);
    });

    it('returns true', () => {
        assertEqual(true, result);
    });
});

describe('AuthenticationSession.isSessionExpired(): session not expired', ({ before, it }) => {

    const options = {
        expirationWindowSeconds: 60,
        refreshWindowEndSeconds: 60,
        refreshWindowStartSeconds: 10,
    };
    const config = {};

    const session = {
        creationDateTime: new Date(Date.now() - (30 * 1000)), // 30 seconds ago
        lastRefreshDateTime: new Date(Date.now() - (30 * 1000)),
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.isSessionExpired(session);
    });

    it('returns false', () => {
        assertEqual(false, result);
    });
});

describe('AuthenticationSession.shouldRefreshSession(): past refresh window start', ({ before, it }) => {

    const options = {
        refreshWindowStartSeconds: 60,
    };
    const config = {};

    const session = {
        creationDateTime: new Date(Date.now() - (120 * 1000)),
        lastRefreshDateTime: new Date(Date.now() - (120 * 1000)), // 2 minutes ago
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.shouldRefreshSession(session);
    });

    it('returns true', () => {
        assertEqual(true, result);
    });
});

describe('AuthenticationSession.shouldRefreshSession(): before refresh window start', ({ before, it }) => {

    const options = {
        refreshWindowStartSeconds: 60,
    };
    const config = {};

    const session = {
        creationDateTime: new Date(Date.now() - (30 * 1000)),
        lastRefreshDateTime: new Date(Date.now() - (30 * 1000)), // 30 seconds ago
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.shouldRefreshSession(session);
    });

    it('returns false', () => {
        assertEqual(false, result);
    });
});

describe('AuthenticationSession.shouldRefreshSession(): refreshWindowStartSeconds is zero', ({ before, it }) => {

    const options = {
        refreshWindowStartSeconds: 0,
    };
    const config = {};

    const session = {
        creationDateTime: new Date(Date.now() - (120 * 1000)),
        lastRefreshDateTime: new Date(Date.now() - (120 * 1000)),
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.shouldRefreshSession(session);
    });

    it('returns false', () => {
        assertEqual(false, result);
    });
});

describe('AuthenticationSession.getCookieMaxAgeSeconds(): with refreshWindowEndSeconds', ({ before, it }) => {

    const options = {
        refreshWindowEndSeconds: 3600, // 1 hour
    };
    const config = {};

    const session = {
        creationDateTime: new Date(),
        lastRefreshDateTime: new Date(),
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.getCookieMaxAgeSeconds(session);
    });

    it('returns seconds until refresh window end', () => {
        // Should be approximately 3600 seconds (allowing for small timing differences)
        assert(result >= 3599 && result <= 3600);
    });
});

describe('AuthenticationSession.getCookieMaxAgeSeconds(): with only expirationWindowSeconds', ({ before, it }) => {

    const options = {
        expirationWindowSeconds: 1555200,
    };
    const config = {};

    const session = {
        creationDateTime: new Date(),
        lastRefreshDateTime: new Date(),
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.getCookieMaxAgeSeconds(session);
    });

    it('returns seconds until expiration', () => {
        assertEqual(1555200, result);
    });
});

describe('AuthenticationSession.getExpirationDateTime(): with expirationWindowSeconds set', ({ before, it }) => {

    const options = {
        expirationWindowSeconds: 1555500,
    };
    const config = {};

    const creationDate = new Date('2024-01-01T00:00:00Z');
    const session = {
        creationDateTime: creationDate,
        lastRefreshDateTime: creationDate,
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.getExpirationDateTime(session);
    });

    it('returns expiration date', () => {
        assert(result instanceof Date);
        assertEqual('2024-01-19T00:05:00.000Z', result.toISOString());
    });
});

describe('AuthenticationSession.getExpirationDateTime(): with expirationWindowSeconds not set', ({ before, it }) => {

    const options = {
        expirationWindowSeconds: 0,
    };
    const config = {};

    const session = {
        creationDateTime: new Date(),
        lastRefreshDateTime: new Date(),
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.getExpirationDateTime(session);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('AuthenticationSession.getRefreshWindowEndDateTime(): with refreshWindowEndSeconds set', ({ before, it }) => {

    const options = {
        refreshWindowEndSeconds: 3600,
    };
    const config = {};

    const refreshDate = new Date('2024-01-01T00:00:00Z');
    const session = {
        creationDateTime: refreshDate,
        lastRefreshDateTime: refreshDate,
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.getRefreshWindowEndDateTime(session);
    });

    it('returns refresh window end date', () => {
        assert(result instanceof Date);
        assertEqual('2024-01-01T01:00:00.000Z', result.toISOString());
    });
});

describe('AuthenticationSession.getRefreshWindowEndDateTime(): with refreshWindowEndSeconds not set', ({ before, it }) => {

    const options = {
    };
    const config = {};

    const session = {
        creationDateTime: new Date(),
        lastRefreshDateTime: new Date(),
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.getExpirationDateTime(session);
    });

    it('returns null', () => {
        assertEqual(7776000000, result.getTime() - session.creationDateTime.getTime());
    });
});

describe('AuthenticationSession.getRefreshWindowStartDateTime(): with refreshWindowStartSeconds set', ({ before, it }) => {

    const options = {
        refreshWindowStartSeconds: 1800,
    };
    const config = {};

    const refreshDate = new Date('2024-01-01T00:00:00Z');
    const session = {
        creationDateTime: refreshDate,
        lastRefreshDateTime: refreshDate,
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.getRefreshWindowStartDateTime(session);
    });

    it('returns refresh window start date', () => {
        assert(result instanceof Date);
        assertEqual('2024-01-01T00:30:00.000Z', result.toISOString());
    });
});

describe('AuthenticationSession.getRefreshWindowStartDateTime(): with refreshWindowStartSeconds not set', ({ before, it }) => {

    const options = {
        refreshWindowStartSeconds: 0,
    };
    const config = {};

    const session = {
        creationDateTime: new Date(),
        lastRefreshDateTime: new Date(),
    };

    let authSession;
    let result;

    before(() => {
        authSession = new AuthenticationSession(options, config);
        result = authSession.getRefreshWindowStartDateTime(session);
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});
