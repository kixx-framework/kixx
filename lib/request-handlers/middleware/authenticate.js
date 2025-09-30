import { UnauthenticatedError } from '../../errors/mod.js';
import { isNonEmptyString, assertNonEmptyString } from '../../assertions/mod.js';


export default function Authenticate(options) {
    const allowAnonymous = isNonEmptyString(options.anonymousUser);
    const allowAuthenticated = isNonEmptyString(options.userCollection);

    if (allowAuthenticated) {
        assertNonEmptyString(options.sessionCollection);
    }

    return async function authenticate(context, request, response) {
        const token = request.getAuthorizationBearer();
        const cookie = request.getCookie('sid');

        // Let the Authorization header override the cookie.
        const sessionId = token || cookie;

        if (allowAuthenticated && sessionId) {
            const sessionCollection = context.getCollection(options.sessionCollection);
            const userCollection = context.getCollection(options.userCollection);

            const session = await sessionCollection.getItem(sessionId);

            if (session.isExpired()) {
                throw new UnauthenticatedError('Session expired');
            }

            assertNonEmptyString(session.userId);

            const user = await userCollection.getItem(session.userId);
            request.setUser(user);

            return response;
        }

        if (allowAnonymous) {
            const User = context.getUserType(options.anonymousUser);
            request.setUser(new User(context));

            return response;
        }

        throw new UnauthenticatedError('Missing required authorization token or cookie');
    };
}
