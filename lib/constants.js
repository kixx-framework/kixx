
// Unicode sentinel values for open-ended key range queries
// ALPHA (\u0000) = lowest possible string, OMEGA (\uffff) = very high value
// Enables queries like "all keys from 'foo' onwards" without specifying end bounds
// Using \uffff instead of true max (\u{10FFFF}) for broader system compatibility
export const ALPHA = '\u0000';
export const OMEGA = '\uffff';
