import { sha256Hex } from '../../../kixx/utils/crypto.js';
import { isNonEmptyString, isPlainObject } from '../../../kixx/assertions/mod.js';


/**
 * In-code fallback policies, used when `config.env.RATE_LIMIT` (or one of its
 * blocks) is absent. These mirror the seeded defaults from the config so the
 * controls stay active even on a misconfigured deployment. The ADMIN_INVITE policy is
 * deliberately the strictest because invite tokens are high-entropy and guessing
 * them should get far less runway than mistyping a password.
 * @type {Object<string, import('../../collections/rate-limit-collection.js').RateLimitPolicy>}
 */
const DEFAULT_POLICIES = Object.freeze({
    ADMIN_LOGIN: { maxFailures: 5, windowSeconds: 900, cooldownSeconds: 900 },
    ADMIN_SIGNUP: { maxFailures: 10, windowSeconds: 900, cooldownSeconds: 900 },
    ADMIN_INVITE: { maxFailures: 3, windowSeconds: 900, cooldownSeconds: 3600 },
});

// A null client IP (no determinable address) collapses into one shared bucket
// rather than throwing; throttling an "unknown" bucket is safer than skipping it.
const UNKNOWN_IP = 'unknown';


/**
 * Checks whether the current login attempt is throttled.
 *
 * Login is limited on two scopes at once: per-IP (catches one source spraying
 * many accounts) and per-(IP, email) (catches a focused attack on one account).
 * Keying the account scope on the IP as well means an attacker can never lock a
 * real admin out from the admin's own IP.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {string} email - Submitted email address; the account scope is skipped when absent.
 * @returns {Promise<import('../../collections/rate-limit-collection.js').RateLimitState>} The more-restrictive state across both scopes.
 */
export async function checkLoginThrottle(context, request, email) {
    const rateLimits = context.getCollection('RateLimit');
    const scopes = await loginScopes(request, email);
    const states = await Promise.all(scopes.map((scope) => rateLimits.getState(context, scope)));
    return mergeStates(states);
}

/**
 * Records one failed login against both login scopes.
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {string} email - Submitted email address; the account scope is skipped when absent.
 * @returns {Promise<import('../../collections/rate-limit-collection.js').RateLimitState>} The more-restrictive state after recording.
 */
export async function recordLoginFailure(context, request, email) {
    const rateLimits = context.getCollection('RateLimit');
    const policy = getPolicy(context, 'ADMIN_LOGIN');
    const scopes = await loginScopes(request, email);
    const states = await Promise.all(scopes.map((scope) => rateLimits.recordFailure(context, scope, policy)));
    return mergeStates(states);
}

/**
 * Clears both login scopes after a successful authentication.
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @param {string} email - Submitted email address; the account scope is skipped when absent.
 * @returns {Promise<void>}
 */
export async function clearLoginThrottle(context, request, email) {
    const rateLimits = context.getCollection('RateLimit');
    const scopes = await loginScopes(request, email);
    await Promise.all(scopes.map((scope) => rateLimits.clear(context, scope)));
}

/**
 * Checks whether signup submissions from this IP are throttled.
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @returns {Promise<import('../../collections/rate-limit-collection.js').RateLimitState>} Current throttle state.
 */
export async function checkSignupThrottle(context, request) {
    const rateLimits = context.getCollection('RateLimit');
    return rateLimits.getState(context, signupScope(request));
}

/**
 * Records one failed signup submission against the per-IP signup scope.
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @returns {Promise<import('../../collections/rate-limit-collection.js').RateLimitState>} Throttle state after recording.
 */
export async function recordSignupFailure(context, request) {
    const rateLimits = context.getCollection('RateLimit');
    return rateLimits.recordFailure(context, signupScope(request), getPolicy(context, 'ADMIN_SIGNUP'));
}

/**
 * Clears the per-IP signup scope after a successful account creation.
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @returns {Promise<void>}
 */
export async function clearSignupThrottle(context, request) {
    const rateLimits = context.getCollection('RateLimit');
    await rateLimits.clear(context, signupScope(request));
}

/**
 * Checks whether invite-token guessing from this IP is throttled.
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @returns {Promise<import('../../collections/rate-limit-collection.js').RateLimitState>} Current throttle state.
 */
export async function checkInviteThrottle(context, request) {
    const rateLimits = context.getCollection('RateLimit');
    return rateLimits.getState(context, inviteScope(request));
}

/**
 * Records one failed invite-token guess against the per-IP invite scope.
 *
 * Call this only when a non-empty invite token resolved non-redeemable, so that
 * legitimate visitors and expired-link clicks are never counted.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Current request.
 * @returns {Promise<import('../../collections/rate-limit-collection.js').RateLimitState>} Throttle state after recording.
 */
export async function recordInviteGuess(context, request) {
    const rateLimits = context.getCollection('RateLimit');
    return rateLimits.recordFailure(context, inviteScope(request), getPolicy(context, 'ADMIN_INVITE'));
}

/**
 * Builds the user-facing throttle message shown on a friendly re-render.
 * @param {number} retryAfterSeconds - Seconds until the lock clears.
 * @returns {string} Message asking the user to wait a whole number of minutes.
 */
export function throttleMessage(retryAfterSeconds) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    const unit = minutes === 1 ? 'minute' : 'minutes';
    return `Too many attempts. Please try again in ${ minutes } ${ unit }.`;
}

// Resolves the policy for a surface from config, falling back per-field to the
// in-code defaults so a partial or missing RATE_LIMIT block cannot disable a
// control or produce an invalid policy.
function getPolicy(context, key) {
    const configured = context.config?.env?.RATE_LIMIT?.[key];
    if (!isPlainObject(configured)) {
        return DEFAULT_POLICIES[key];
    }
    return Object.assign({}, DEFAULT_POLICIES[key], configured);
}

function clientIp(request) {
    return isNonEmptyString(request.ip) ? request.ip : UNKNOWN_IP;
}

async function loginScopes(request, email) {
    const ip = clientIp(request);
    const scopes = [ `login:ip:${ ip }` ];

    // The account scope is keyed on IP + email together; skip it when no email
    // was submitted, leaving the per-IP scope to catch the attempt.
    if (isNonEmptyString(email)) {
        const emailHash = await sha256Hex(email);
        scopes.push(`login:ipemail:${ ip }:${ emailHash }`);
    }

    return scopes;
}

function signupScope(request) {
    return `signup:ip:${ clientIp(request) }`;
}

function inviteScope(request) {
    return `invite:ip:${ clientIp(request) }`;
}

function mergeStates(states) {
    return states.reduce((merged, state) => {
        return {
            throttled: merged.throttled || state.throttled,
            retryAfterSeconds: Math.max(merged.retryAfterSeconds, state.retryAfterSeconds),
        };
    }, { throttled: false, retryAfterSeconds: 0 });
}
