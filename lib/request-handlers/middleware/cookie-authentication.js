import { UnauthenticatedError, AssertionError } from '../../errors/mod.js';

const DEFAULT_USER_COLLECTION_KEY = 'app.User';
const DEFAULT_SESSION_COOKIE_ID = 'sid';
const DEFAULT_REFRESH_WINDOW_START_SECONDS = 60 * 15;
const DEFAULT_REFRESH_WINDOW_END_SECONDS = 60 * 60 * 24 * 18;
const DEFAULT_EXPIRATION_WINDOW_SECONDS = 60 * 60 * 24 * 90;

/**
 * If a session window start and end is defined then a session can be refreshed
 * within the window. If the current time is within the refresh window, then
 * it can be refreshed. If the current time is outside the refresh window
 * then the session is considered expired.
 */
class AuthenticationSession {

    constructor(options, config) {
        this.currentDateTime = new Date();
        this.refreshWindowStartSeconds = DEFAULT_REFRESH_WINDOW_START_SECONDS;
        this.refreshWindowEndSeconds = DEFAULT_REFRESH_WINDOW_END_SECONDS;
        this.expirationWindowSeconds = DEFAULT_EXPIRATION_WINDOW_SECONDS;

        // Override defaults with configs
        if (Number.isInteger(config.refreshWindowStartSeconds)) {
            this.refreshWindowStartSeconds = config.refreshWindowStartSeconds;
        }
        // Override configs with explicit options
        if (Number.isInteger(options.refreshWindowStartSeconds)) {
            this.refreshWindowStartSeconds = options.refreshWindowStartSeconds;
        }

        // Override defaults with configs
        if (Number.isInteger(config.refreshWindowEndSeconds)) {
            this.refreshWindowEndSeconds = config.refreshWindowEndSeconds;
        }
        // Override configs with explicit options.
        if (Number.isInteger(options.refreshWindowEndSeconds)) {
            this.refreshWindowEndSeconds = options.refreshWindowEndSeconds;
        }

        // Override defaults with configs
        if (Number.isInteger(config.expirationWindowSeconds)) {
            this.expirationWindowSeconds = config.expirationWindowSeconds;
        }
        // Override configs with explicit options.
        if (Number.isInteger(options.expirationWindowSeconds)) {
            this.expirationWindowSeconds = options.expirationWindowSeconds;
        }

        if (!this.expirationWindowSeconds && !this.refreshWindowEndSeconds) {
            throw new AssertionError(`The CookieAuthentication expirationWindowSeconds or refreshWindowEndSeconds must be set greater than zero`);
        }
        if (this.refreshWindowStartSeconds > this.refreshWindowEndSeconds) {
            throw new AssertionError(`The CookieAuthentication refreshWindowStartSeconds (${ this.refreshWindowStartSeconds }) must be less than refreshWindowEndSeconds (${ this.refreshWindowEndSeconds })`);
        }
    }

    isSessionExpired(session) {
        const expirationDateTime = this.getExpirationDateTime(session);
        if (expirationDateTime) {
            return this.currentDateTime > expirationDateTime;
        }

        const refreshWindowEndDateTime = this.getRefreshWindowEndDateTime(session);
        return this.currentDateTime > refreshWindowEndDateTime;
    }

    shouldRefreshSession(session) {
        const refreshWindowStartDateTime = this.getRefreshWindowStartDateTime(session);
        if (refreshWindowStartDateTime) {
            return this.currentDateTime > refreshWindowStartDateTime;
        }
        return false;
    }

    getCookieMaxAgeSeconds(session) {
        let staleDateTime;
        if (this.refreshWindowEndSeconds) {
            staleDateTime = this.getRefreshWindowEndDateTime(session);
        } else {
            staleDateTime = this.getExpirationDateTime(session);
        }

        const milliseconds = staleDateTime.getTime() - this.currentDateTime.getTime();
        return Math.ceil(milliseconds / 1000);
    }

    getExpirationDateTime(session) {
        if (this.expirationWindowSeconds) {
            const windowMs = this.expirationWindowSeconds * 1000;
            return new Date(Math.floor(session.creationDateTime.getTime() + windowMs));
        }
        return null;
    }

    getRefreshWindowEndDateTime(session) {
        if (this.refreshWindowEndSeconds) {
            const windowMs = this.refreshWindowEndSeconds * 1000;
            return new Date(Math.floor(session.lastRefreshDateTime.getTime() + windowMs));
        }
        return null;
    }

    getRefreshWindowStartDateTime(session) {
        if (this.refreshWindowStartSeconds) {
            const windowMs = this.refreshWindowStartSeconds * 1000;
            return new Date(Math.floor(session.lastRefreshDateTime.getTime() + windowMs));
        }
        return null;
    }
}

export default function CookieAuthentication(options) {

    const allowAnonymous = Boolean(options.allowAnonymous);

    return async function cookieAuthentication(context, request, response) {
        const config = context.config.getNamespace('CookieAuthentication');

        const authSession = new AuthenticationSession(options, config);

        const userCollectionKey = options.userCollection || config.userCollection || DEFAULT_USER_COLLECTION_KEY;
        const sessionCookieId = options.sessionCookieId || config.sessionCookieId || DEFAULT_SESSION_COOKIE_ID;

        const userCollection = context.getCollection(userCollectionKey);

        const sessionId = request.getCookie(sessionCookieId);

        let user;
        let originalSession;
        let newSession;

        if (sessionId) {
            originalSession = await userCollection.getSession(sessionId);

            if (!originalSession) {
                throw new UnauthenticatedError(`User session ID (${ sessionCookieId }) is invalid`, {
                    code: 'UNAUTHENTICATED_INVALID_SESSION',
                });
            }

            // The session doesn't support refresh or is outside of
            // the refresh window.
            if (authSession.isSessionExpired(originalSession)) {
                throw new UnauthenticatedError('User session expired', {
                    code: 'UNAUTHENTICATED_SESSION_EXPIRED',
                });
            }

            if (authSession.shouldRefreshSession(originalSession)) {
                // The session is within the refresh window.
                newSession = await userCollection.refreshSession(originalSession);
                user = await userCollection.getUserFromSession(newSession);
            } else {
                // The session is still fresh.
                user = await userCollection.getUserFromSession(originalSession);
            }
        } else if (allowAnonymous) {
            user = await userCollection.createAnonymousUser();
            newSession = await userCollection.createSession(user);
        } else {
            throw new UnauthenticatedError('No authentication id', {
                code: 'UNAUTHENTICATED_NO_SESSION_ID',
            });
        }

        // eslint-disable-next-line require-atomic-updates
        request.user = user;

        // If the session was refreshed, then reset the session cookie.
        if (newSession && newSession.id !== originalSession?.id) {
            response.setCookie(sessionCookieId, newSession.id, {
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'Strict',
                maxAge: authSession.getCookieMaxAgeSeconds(newSession),
            });
        }

        return response;
    };
}
