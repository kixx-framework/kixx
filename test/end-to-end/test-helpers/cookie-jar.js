/**
 * @typedef {Object} CookieJarCookie
 * @property {string} value - Cookie value.
 * @property {number|null} maxAge - Lifetime in seconds from Max-Age.
 * @property {string|null} expires - Expiration date from Expires.
 * @property {string|null} domain - Domain scope.
 * @property {string|null} path - URL path scope.
 * @property {boolean} secure - Whether the Secure attribute was sent.
 * @property {boolean} httpOnly - Whether the HttpOnly attribute was sent.
 * @property {string|null} sameSite - SameSite policy.
 * @property {boolean} partitioned - Whether the Partitioned attribute was sent.
 */

/**
 * Minimal cookie jar for end-to-end tests.
 */
export default class CookieJar {

    #cookies = new Map();

    /**
     * Reads `Set-Cookie` headers from a Response and updates the jar.
     * @param {Response} response
     * @returns {CookieJar}
     */
    applyResponse(response) {
        const setCookieHeaders = typeof response.headers.getSetCookie === 'function'
            ? response.headers.getSetCookie()
            : [];

        for (const header of setCookieHeaders) {
            this.#applySetCookie(header);
        }

        return this;
    }

    /**
     * Returns a `Cookie` header for every live cookie, or a named live subset.
     * Expired entries are dropped from the jar.
     * @param {Iterable<string>|null} [names] - Cookie names to include. Omitting it includes every live cookie.
     * @returns {string}
     */
    cookieHeader(names = null) {
        const pairs = [];
        const cookieNames = names ?? this.#cookies.keys();

        for (const name of cookieNames) {
            const entry = this.#getLiveEntry(name);
            if (!entry) {
                continue;
            }
            pairs.push(`${ name }=${ entry.value }`);
        }

        return pairs.join('; ');
    }

    /**
     * Returns a cookie and its attributes, or null if it is absent or expired.
     * @param {string} name
     * @returns {CookieJarCookie|null} Cookie value and attributes.
     */
    get(name) {
        const entry = this.#getLiveEntry(name);
        if (!entry) {
            return null;
        }
        return {
            value: entry.value,
            maxAge: entry.maxAge,
            expires: entry.expires,
            domain: entry.domain,
            path: entry.path,
            secure: entry.secure,
            httpOnly: entry.httpOnly,
            sameSite: entry.sameSite,
            partitioned: entry.partitioned,
        };
    }

    #applySetCookie(header) {
        const parts = header.split(';').map((part) => part.trim());
        const [ first ] = parts;
        const eq = first.indexOf('=');
        if (eq < 0) {
            return;
        }

        const name = first.slice(0, eq);
        const value = first.slice(eq + 1);

        let maxAge = null;
        let expires = null;
        let expiresAt = null;
        let domain = null;
        let path = null;
        let secure = false;
        let httpOnly = false;
        let sameSite = null;
        let partitioned = false;

        for (let i = 1; i < parts.length; i += 1) {
            const attr = parts[i];
            const lower = attr.toLowerCase();
            if (lower.startsWith('max-age=')) {
                const seconds = Number.parseInt(attr.slice('max-age='.length), 10);
                if (Number.isFinite(seconds)) {
                    maxAge = seconds;
                }
            } else if (lower.startsWith('expires=')) {
                expires = attr.slice('expires='.length);
                const parsed = Date.parse(attr.slice('expires='.length));
                if (!Number.isNaN(parsed)) {
                    expiresAt = parsed;
                }
            } else if (lower.startsWith('domain=')) {
                domain = attr.slice('domain='.length);
            } else if (lower.startsWith('path=')) {
                path = attr.slice('path='.length);
            } else if (lower === 'secure') {
                secure = true;
            } else if (lower === 'httponly') {
                httpOnly = true;
            } else if (lower.startsWith('samesite=')) {
                sameSite = attr.slice('samesite='.length);
            } else if (lower === 'partitioned') {
                partitioned = true;
            }
        }

        // Max-Age takes precedence over Expires when both attributes are present.
        if (maxAge !== null) {
            expiresAt = Date.now() + (maxAge * 1000);
        }

        if (expiresAt !== null && expiresAt <= Date.now()) {
            this.#cookies.delete(name);
            return;
        }

        this.#cookies.set(name, {
            value,
            maxAge,
            expires,
            expiresAt,
            domain,
            path,
            secure,
            httpOnly,
            sameSite,
            partitioned,
        });
    }

    #getLiveEntry(name) {
        const entry = this.#cookies.get(name);
        if (!entry) {
            return null;
        }
        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            this.#cookies.delete(name);
            return null;
        }

        return entry;
    }
}
