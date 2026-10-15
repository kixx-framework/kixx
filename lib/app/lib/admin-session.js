// Admin session lifetime in seconds. Owned here as the single source of truth
// for both the stored UserSession expiration (admin signup, login, and
// authentication workflows) and the presentation cookie's maxAge, which imports
// this value to keep the browser cookie aligned with the stored session.
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 3;
