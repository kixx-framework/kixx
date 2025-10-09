import { UnauthenticatedError } from '../../errors/mod.js';
import { isNonEmptyString, assertNonEmptyString } from '../../assertions/mod.js';

const DEFAULT_USER_COLLECTION_KEY = 'app.User';
const DEFAULT_SESSION_COOKIE_ID = 'sid';
const DEFAULT_SESSION_SLIDING_WINDOW_SECONDS = 60 * 60 * 4;

export default function CookieAuthentication(options) {

    const allowAnonymous = Boolean(options.allowAnonymous);

    return async function cookieAuthentication(context, request, response) {
        const config = context.config.getNamespace('authentication');

        const userCollectionKey = options.userCollection || config.userCollection || DEFAULT_USER_COLLECTION_KEY;
        const sessionCookieId = options.sessionCookieId || config.sessionCookieId || DEFAULT_SESSION_COOKIE_ID;

        let sessionSlidingWindowSeconds = DEFAULT_SESSION_SLIDING_WINDOW_SECONDS;
        if (Number.isInteger(config.sessionSlidingWindowSeconds)) {
            sessionSlidingWindowSeconds = config.sessionSlidingWindowSeconds;
        }
        if (Number.isInteger(options.sessionSlidingWindowSeconds)) {
            sessionSlidingWindowSeconds = options.sessionSlidingWindowSeconds;
        }

        const userCollection = context.getCollection(userCollectionKey);

        const sessionId = request.getCookie(sessionCookieId);

        let user;
        let originalSession;
        let newSession;

        if (sessionId) {
            originalSession = await userCollection.getSession(sessionId);

            if (originalSession.isExpired) {
                throw new UnauthenticatedError('User session expired', {
                    code: 'UNAUTHENTICATED_SESSION_EXPIRED',
                });
            }
            if (originalSession.canRefresh(sessionSlidingWindowSeconds)) {
                newSession = await userCollection.refreshSession(originalSession);
            }
        } else if (allowAnonymous) {
            user = await userCollection.createAnonymousUser();
            newSession = await userCollection.createSession(user);
        } else {
            throw new UnauthenticatedError('No authentication id', {
                code: 'UNAUTHENTICATED_NO_SESSION_ID',
            });
        }

        // If the session was refreshed, then reset the session cookie.
        if (newSession && newSession.id !== originalSession?.id) {
            response.setCookie(sessionCookieId, newSession.id, {
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'Strict',
                maxAge: session.ttlSeconds,
            });
        }

        return response;
    };
}
