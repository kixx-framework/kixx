// This URL-safe segment represents the flat static-file-store root when a
// deployment has no Build ID. Hyperview writes it into asset URLs and the
// static asset handler maps it back to a null namespace.
export const NO_BUILD_ID_SEGMENT = 'dev';
