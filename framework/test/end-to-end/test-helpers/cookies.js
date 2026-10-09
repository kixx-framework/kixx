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
        for (const cookie of getSetCookies(response)) {
            this.#applySetCookie(cookie);
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

    #applySetCookie(cookie) {
        const {
            name,
            value,
            maxAge,
            expires,
            expiresAt: parsedExpiresAt,
            domain,
            path,
            secure,
            httpOnly,
            sameSite,
            partitioned,
        } = cookie;
        let expiresAt = parsedExpiresAt;

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

/**
 * Parses every Set-Cookie header from a response.
 * @param {Response} response - Response carrying Set-Cookie headers.
 * @returns {Array<CookieJarCookie & {name: string, expiresAt: number|null}>} Parsed cookies.
 */
export function getSetCookies(response) {
    const getSetCookie = response.headers.getSetCookie;
    if (typeof getSetCookie !== 'function') {
        return [];
    }

    return getSetCookie.call(response.headers)
        .map(parseSetCookie)
        .filter((cookie) => cookie !== null);
}

function parseSetCookie(header) {
    const parts = header.split(';').map((part) => part.trim());
    const [ first ] = parts;
    const equalSign = first.indexOf('=');
    if (equalSign < 0) {
        return null;
    }

    const name = first.slice(0, equalSign);
    const value = first.slice(equalSign + 1);

    let maxAge = null;
    let expires = null;
    let expiresAt = null;
    let domain = null;
    let path = null;
    let secure = false;
    let httpOnly = false;
    let sameSite = null;
    let partitioned = false;

    for (let index = 1; index < parts.length; index += 1) {
        const attribute = parts[index];
        const lowercaseAttribute = attribute.toLowerCase();
        if (lowercaseAttribute.startsWith('max-age=')) {
            const seconds = Number.parseInt(attribute.slice('max-age='.length), 10);
            if (Number.isFinite(seconds)) {
                maxAge = seconds;
            }
        } else if (lowercaseAttribute.startsWith('expires=')) {
            expires = attribute.slice('expires='.length);
            const parsed = Date.parse(expires);
            if (!Number.isNaN(parsed)) {
                expiresAt = parsed;
            }
        } else if (lowercaseAttribute.startsWith('domain=')) {
            domain = attribute.slice('domain='.length);
        } else if (lowercaseAttribute.startsWith('path=')) {
            path = attribute.slice('path='.length);
        } else if (lowercaseAttribute === 'secure') {
            secure = true;
        } else if (lowercaseAttribute === 'httponly') {
            httpOnly = true;
        } else if (lowercaseAttribute.startsWith('samesite=')) {
            sameSite = attribute.slice('samesite='.length);
        } else if (lowercaseAttribute === 'partitioned') {
            partitioned = true;
        }
    }

    if (maxAge !== null) {
        expiresAt = Date.now() + (maxAge * 1000);
    }

    return {
        name,
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
    };
}
