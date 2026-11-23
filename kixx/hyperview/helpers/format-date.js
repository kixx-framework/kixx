import * as KixxTemplating from '../../vendor/templating/mod.js';
import { isDate, isPlainObject, toFriendlyString } from '../../assertions/mod.js';

const { escapeHTMLChars } = KixxTemplating;

/*
# Formats

The preset names are kept from v6. Examples are for October 14, 1983 at
13:30:23 in America/New_York, with `locale="en-US"`.

| Name                        | Example                                                      |
|-----------------------------|--------------------------------------------------------------|
| DATE_SHORT                  | 10/14/1983                                                   |
| DATE_MED                    | Oct 14, 1983                                                 |
| DATE_MED_WITH_WEEKDAY       | Fri, Oct 14, 1983                                            |
| DATE_FULL                   | October 14, 1983                                             |
| DATE_HUGE                   | Friday, October 14, 1983                                     |
| DATE_MONTH_DATE             | Oct 14                                                       |
| TIME_SIMPLE                 | 1:30 PM                                                      |
| TIME_WITH_SECONDS           | 1:30:23 PM                                                   |
| TIME_WITH_SHORT_OFFSET      | 1:30:23 PM EDT                                               |
| TIME_WITH_LONG_OFFSET       | 1:30:23 PM Eastern Daylight Time                             |
| TIME_24_SIMPLE              | 13:30                                                        |
| TIME_24_WITH_SECONDS        | 13:30:23                                                     |
| TIME_24_WITH_SHORT_OFFSET   | 13:30:23 EDT                                                 |
| TIME_24_WITH_LONG_OFFSET    | 13:30:23 Eastern Daylight Time                               |
| DATETIME_SHORT              | 10/14/1983, 1:30 PM                                          |
| DATETIME_SHORT_WITH_SECONDS | 10/14/1983, 1:30:23 PM                                       |
| DATETIME_MED                | Oct 14, 1983, 1:30 PM                                        |
| DATETIME_MED_WITH_SECONDS   | Oct 14, 1983, 1:30:23 PM                                     |
| DATETIME_MED_WITH_WEEKDAY   | Fri, Oct 14, 1983, 1:30 PM                                   |
| DATETIME_FULL               | October 14, 1983 at 1:30 PM EDT                              |
| DATETIME_FULL_WITH_SECONDS  | October 14, 1983 at 1:30:23 PM EDT                           |
| DATETIME_HUGE               | Friday, October 14, 1983 at 1:30 PM Eastern Daylight Time    |
| DATETIME_HUGE_WITH_SECONDS  | Friday, October 14, 1983 at 1:30:23 PM Eastern Daylight Time |
| ISO                         | 1983-10-14T13:30:23.000-04:00                                |
| ISO_DATE                    | 1983-10-14                                                   |
| ISO_DATE_TIME_24            | 1983-10-14 13:30                                             |
| UTC                         | Fri, 14 Oct 1983 17:30:23 GMT                                |

Localized output comes from the runtime's Intl data, so it can differ slightly
between runtimes for some locales. ISO, ISO_DATE, and ISO_DATE_TIME_24 always
use ASCII digits. UTC is the RFC 7231 HTTP date: always the UTC instant in
English, ignoring `zone` and `locale`.
*/

const DEFAULT_FORMAT = 'DATETIME_SHORT';

// Each value is either Intl.DateTimeFormat options or a function which formats
// the instant itself. A Map, so names like `toString` and `__proto__` are misses.
const FORMATS = new Map([
    [ 'DATE_SHORT', { year: 'numeric', month: 'numeric', day: 'numeric' } ],
    [ 'DATE_MED', { year: 'numeric', month: 'short', day: 'numeric' } ],
    [ 'DATE_MED_WITH_WEEKDAY', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' } ],
    [ 'DATE_FULL', { year: 'numeric', month: 'long', day: 'numeric' } ],
    [ 'DATE_HUGE', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' } ],
    [ 'DATE_MONTH_DATE', { month: 'short', day: 'numeric' } ],
    [ 'TIME_SIMPLE', { hour: 'numeric', minute: 'numeric' } ],
    [ 'TIME_WITH_SECONDS', { hour: 'numeric', minute: 'numeric', second: 'numeric' } ],
    [ 'TIME_WITH_SHORT_OFFSET', { hour: 'numeric', minute: 'numeric', second: 'numeric', timeZoneName: 'short' } ],
    [ 'TIME_WITH_LONG_OFFSET', { hour: 'numeric', minute: 'numeric', second: 'numeric', timeZoneName: 'long' } ],
    [ 'TIME_24_SIMPLE', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' } ],
    [ 'TIME_24_WITH_SECONDS', { hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' } ],
    [ 'TIME_24_WITH_SHORT_OFFSET', { hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', timeZoneName: 'short' } ],
    [ 'TIME_24_WITH_LONG_OFFSET', { hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', timeZoneName: 'long' } ],
    [ 'DATETIME_SHORT', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' } ],
    [ 'DATETIME_SHORT_WITH_SECONDS', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' } ],
    [ 'DATETIME_MED', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' } ],
    [ 'DATETIME_MED_WITH_SECONDS', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' } ],
    [ 'DATETIME_MED_WITH_WEEKDAY', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric' } ],
    [ 'DATETIME_FULL', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', timeZoneName: 'short' } ],
    [ 'DATETIME_FULL_WITH_SECONDS', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', timeZoneName: 'short' } ],
    [ 'DATETIME_HUGE', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric', timeZoneName: 'long' } ],
    [ 'DATETIME_HUGE_WITH_SECONDS', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric', second: 'numeric', timeZoneName: 'long' } ],
    [ 'ISO', formatISO ],
    [ 'ISO_DATE', formatISODate ],
    [ 'ISO_DATE_TIME_24', formatISODateTime24 ],
    [ 'UTC', formatUTC ],
]);

// The ECMAScript Date range, in milliseconds either side of the epoch.
const MAX_TIMESTAMP = 8.64e15;
const DAY_MS = 86400000;
const MINUTE_MS = 60000;

const UNIT_NAMES = [ 'year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond' ];

// Basic or extended ISO 8601 calendar date, with an optional time after `T`.
// Groups: year, month, day, hour, minute, second, fraction, Z, offset hours,
// offset minutes.
const ISO_PATTERN = /^([+-]\d{6}|\d{4})(?:-?(\d\d)(?:-?(\d\d))?)?(?:[Tt](\d\d)(?::?(\d\d)(?::?(\d\d)(?:[.,](\d{1,30}))?)?)?(?:([Zz])|([+-]\d\d)(?::?(\d\d))?)?)?$/;

const SYSTEM_ZONE = Object.freeze({ timeZone: undefined, isFixedUTC: false });
const FIXED_UTC_ZONE = Object.freeze({ timeZone: 'UTC', isFixedUTC: true });

// Building an Intl.DateTimeFormat costs about 20 times more than reusing one,
// which adds up in a table of dates. Zone and locale strings can come from
// data, so the cache is capped rather than allowed to grow without bound.
const FORMATTER_CACHE_LIMIT = 500;
const formatterCache = new Map();


/**
 * Template helper which formats a date-like value with `Intl.DateTimeFormat`.
 *
 * Accepts any of these, so a page can carry whichever representation its data
 * source produced:
 * - An ISO 8601 calendar date or date-time string, basic or extended, with an
 *   optional time after `T`, optional seconds and fraction, and an optional
 *   offset (`Z` or `±HH[:MM]`). Week dates, ordinal dates, time-only strings,
 *   and a space separator are not accepted.
 * - A millisecond timestamp (a number) or a `Date`.
 * - A plain object of date parts with exactly the keys `year`, `month`, `day`,
 *   `hour`, `minute`, `second`, and `millisecond`. Values are numbers; `null`
 *   counts as missing. `year` is required, and a missing smaller unit takes
 *   its minimum.
 *
 * A string without an offset, or an object of date parts, is wall-clock time
 * in `zone`. A repeated wall-clock time (the clocks going back) resolves to the
 * earlier occurrence, and a skipped one moves forward by the length of the gap.
 * A value with an offset is that instant, shown in `zone`.
 *
 * Never throws: a bad date in one field should not take down the page around
 * it. Problems render an escaped message in place instead, because helper
 * output is not escaped by the renderer and the value came from data:
 * - `Invalid date (<reason>) <value>` for a value which cannot be read, or an unsupported zone
 * - `Invalid date <value>` for a value of a type which is never a date
 * - `Unknown date format <name>`
 * - `Invalid locale <tag>` for a malformed locale tag; a well-formed but unknown tag falls back to the runtime default
 * @param {Object} _context - Current template frame value; unused
 * @param {Object} options - Named helper arguments
 * @param {string} [options.format='DATETIME_SHORT'] - A format name from the table above; an empty string also means `DATETIME_SHORT`
 * @param {string} [options.zone] - An IANA time zone name (any case; aliases work), or `UTC` or `GMT` for the fixed UTC zone, where `ISO` ends in `Z` and zone names print `UTC`; defaults to the runtime's zone
 * @param {string} [options.locale] - BCP 47 locale tag, such as `en-US`; defaults to the runtime's locale
 * @param {string|number|Date|Object} date - Value to format
 * @returns {string} The formatted date, an empty string for an empty string, null, or undefined, or an escaped message
 * @see formatDate Helper in ../../../templates/README.md for template usage
 */
export default function formatDate(_context, options, date) {
    if (date === '' || date === null || typeof date === 'undefined') {
        return '';
    }

    try {
        return formatValue(options ?? {}, date);
    } catch (error) {
        return renderInvalidDate(error?.message, date);
    }
}

function formatValue(options, date) {
    const { format, zone, locale } = options;

    const formatName = (typeof format === 'undefined' || format === '') ? DEFAULT_FORMAT : format;
    const formatter = FORMATS.get(formatName);

    if (!formatter) {
        return escapeHTMLChars(`Unknown date format ${ toFriendlyString(format) }`);
    }

    const resolvedZone = resolveZone(zone);

    if (!resolvedZone) {
        return renderInvalidDate('unsupported zone', date);
    }

    const result = toInstant(resolvedZone, date);

    if (typeof result.instant === 'undefined') {
        return result.reason ? renderInvalidDate(result.reason, date) : renderNotADate(date);
    }

    if (!isWallTimeInDateRange(resolvedZone, result.instant)) {
        return renderInvalidDate('invalid input', date);
    }

    if (typeof formatter === 'function') {
        return formatter(resolvedZone, result.instant);
    }

    const formatted = formatWithIntl(formatName, formatter, resolvedZone, locale, result.instant);

    if (formatted === null) {
        return escapeHTMLChars(`Invalid locale ${ toFriendlyString(locale) }`);
    }

    return formatted;
}

function renderInvalidDate(reason, value) {
    return escapeHTMLChars(`Invalid date (${ reason }) ${ describeValue(value) }`);
}

function renderNotADate(value) {
    return escapeHTMLChars(`Invalid date ${ describeValue(value) }`);
}

function describeValue(value) {
    // The message is the last line of defense, so it must not throw either; a
    // Proxy or a hostile getter can make even describing the value fail.
    try {
        return toFriendlyString(value);
    } catch {
        return 'unknown value';
    }
}

// Returns a zone descriptor, or null when the zone is unsupported.
function resolveZone(zone) {
    if (typeof zone === 'undefined' || zone === null || zone === '') {
        return SYSTEM_ZONE;
    }

    if (typeof zone !== 'string') {
        return null;
    }

    const lowerCased = zone.toLowerCase();

    if (lowerCased === 'utc' || lowerCased === 'gmt') {
        return FIXED_UTC_ZONE;
    }

    // Intl decides which IANA names exist. Building the parts formatter checks
    // the name, and it is needed for offsets anyway, so the check costs nothing
    // extra once cached.
    try {
        getPartsFormatter(zone);
    } catch (error) {
        if (error instanceof RangeError) {
            return null;
        }
        throw error;
    }

    return { timeZone: zone, isFixedUTC: false };
}

// Returns { instant } on success, { reason } for an unreadable value, or {}
// for a value of a type which is never a date.
function toInstant(zone, value) {
    if (typeof value === 'string') {
        return stringToInstant(zone, value);
    }

    // Only number primitives are timestamps; a bigint is never a date.
    if (typeof value === 'number') {
        if (Number.isNaN(value)) {
            return {};
        }
        if (Math.abs(value) > MAX_TIMESTAMP) {
            return { reason: 'Timestamp out of range' };
        }
        // Date truncates fractional milliseconds toward zero.
        return { instant: new Date(value).getTime() };
    }

    if (isDate(value)) {
        const instant = value.getTime();
        return Number.isNaN(instant) ? { reason: 'invalid input' } : { instant };
    }

    if (isPlainObject(value)) {
        return objectToInstant(zone, value);
    }

    if (typeof value === 'object') {
        return { reason: 'invalid input' };
    }

    return {};
}

function stringToInstant(zone, value) {
    const match = ISO_PATTERN.exec(value);

    if (!match) {
        return { reason: 'unparsable' };
    }

    const [
        ,
        yearText,
        monthText,
        dayText,
        hourText,
        minuteText,
        secondText,
        fractionText,
        zuluText,
        offsetHourText,
        offsetMinuteText,
    ] = match;

    const fields = {
        year: parseInt(yearText, 10),
        month: parseOptionalInteger(monthText, 1),
        day: parseOptionalInteger(dayText, 1),
        hour: parseOptionalInteger(hourText, 0),
        minute: parseOptionalInteger(minuteText, 0),
        second: parseOptionalInteger(secondText, 0),
        // A fraction of any length is floored to whole milliseconds.
        millisecond: fractionText ? Math.floor(parseFloat(`0.${ fractionText }`) * 1000) : 0,
    };

    if (!areFieldsInRange(fields)) {
        return { reason: 'unit out of range' };
    }

    if (!zuluText && !offsetHourText) {
        return wallClockToInstant(zone, fields);
    }

    const localTimestamp = toLocalTimestamp(fields);
    const instant = localTimestamp - (parseOffset(offsetHourText, offsetMinuteText) * MINUTE_MS);

    return isInDateRange(instant) ? { instant } : { reason: 'invalid input' };
}

function parseOptionalInteger(text, fallback) {
    return typeof text === 'undefined' ? fallback : parseInt(text, 10);
}

// Returns the offset in minutes. Offsets are deliberately not range checked.
function parseOffset(hourText, minuteText) {
    if (!hourText) {
        return 0;
    }

    const hours = parseInt(hourText, 10);
    const minutes = minuteText ? parseInt(minuteText, 10) : 0;

    // `-00:30` parses its hours as -0, which still makes the minutes negative.
    const isNegative = hours < 0 || Object.is(hours, -0);

    return (hours * 60) + (isNegative ? -minutes : minutes);
}

function objectToInstant(zone, value) {
    const keys = Object.keys(value);

    for (const key of keys) {
        if (!UNIT_NAMES.includes(key)) {
            return { reason: `Invalid unit ${ key }` };
        }
    }

    for (const key of keys) {
        const unitValue = value[key];

        if (unitValue === null || typeof unitValue === 'undefined') {
            continue;
        }
        if (typeof unitValue !== 'number' || !Number.isFinite(unitValue)) {
            return { reason: `Invalid unit value ${ String(unitValue) }` };
        }
    }

    // Defaults for the larger units would have to come from the clock, and
    // output which depends on the day it renders is a bug. So year is required.
    if (value.year === null || typeof value.year === 'undefined') {
        return { reason: 'missing year' };
    }

    const fields = {
        year: value.year,
        month: value.month ?? 1,
        day: value.day ?? 1,
        hour: value.hour ?? 0,
        minute: value.minute ?? 0,
        second: value.second ?? 0,
        millisecond: value.millisecond ?? 0,
    };

    if (!areFieldsInRange(fields)) {
        return { reason: 'unit out of range' };
    }

    return wallClockToInstant(zone, fields);
}

function areFieldsInRange(fields) {
    const { year, month, day, hour, minute, second, millisecond } = fields;

    if (!Number.isInteger(year) || !isIntegerBetween(month, 1, 12)) {
        return false;
    }
    if (!isIntegerBetween(day, 1, daysInMonth(year, month))) {
        return false;
    }
    if (!isIntegerBetween(minute, 0, 59) || !isIntegerBetween(second, 0, 59) || !isIntegerBetween(millisecond, 0, 999)) {
        return false;
    }

    // Hour 24 is allowed only as the end of the day, 24:00:00.000.
    return isIntegerBetween(hour, 0, 23) || (hour === 24 && minute === 0 && second === 0 && millisecond === 0);
}

function isIntegerBetween(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

function daysInMonth(year, month) {
    if (month === 2) {
        const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        return isLeapYear ? 29 : 28;
    }
    return [ 4, 6, 9, 11 ].includes(month) ? 30 : 31;
}

// Reads wall-clock fields as if they were UTC. Date.UTC() and new Date(y, ...)
// would map years 0-99 to 1900-1999, so the setters are used instead. Hour 24
// rolls over into the next day. Returns NaN outside the Date range.
function toLocalTimestamp(fields) {
    const date = new Date(0);
    date.setUTCFullYear(fields.year, fields.month - 1, fields.day);
    date.setUTCHours(fields.hour, fields.minute, fields.second, fields.millisecond);
    return date.getTime();
}

function wallClockToInstant(zone, fields) {
    const localTimestamp = toLocalTimestamp(fields);

    if (Number.isNaN(localTimestamp)) {
        return { reason: 'invalid input' };
    }

    if (zone.isFixedUTC) {
        return { instant: localTimestamp };
    }

    // The offset in effect at the wall time is one of the zone's offsets near
    // it. Sampling a day either side catches both sides of any transition.
    const candidates = new Set([
        offsetAt(zone, clampToDateRange(localTimestamp - DAY_MS)),
        offsetAt(zone, clampToDateRange(localTimestamp)),
        offsetAt(zone, clampToDateRange(localTimestamp + DAY_MS)),
    ]);

    const matches = [];

    for (const offset of candidates) {
        const instant = localTimestamp - offset;

        if (offsetAt(zone, clampToDateRange(instant)) === offset) {
            matches.push(instant);
        }
    }

    let instant;

    if (matches.length > 0) {
        // More than one match is a repeated wall time when the clocks go back.
        // Take the earlier occurrence, so output never depends on today's date.
        instant = Math.min(...matches);
    } else {
        // No match is a wall time skipped when the clocks go forward. Using the
        // offset from before the transition moves it forward by the gap.
        instant = localTimestamp - Math.min(...candidates);
    }

    return isInDateRange(instant) ? { instant } : { reason: 'invalid input' };
}

function isInDateRange(timestamp) {
    return Math.abs(timestamp) <= MAX_TIMESTAMP;
}

// An instant at the edge of the Date range can have a wall time in the zone
// which is past the edge, and so has no date fields to print.
function isWallTimeInDateRange(zone, instant) {
    if (Math.abs(instant) <= MAX_TIMESTAMP - DAY_MS) {
        return true;
    }
    return isInDateRange(instant + offsetAt(zone, instant));
}

function clampToDateRange(timestamp) {
    return Math.min(Math.max(timestamp, -MAX_TIMESTAMP), MAX_TIMESTAMP);
}

// Returns the zone's offset from UTC at the instant, in milliseconds.
function offsetAt(zone, instant) {
    if (zone.isFixedUTC) {
        return 0;
    }

    const parts = getPartsFormatter(zone.timeZone).formatToParts(instant);
    const fields = {};

    for (const { type, value } of parts) {
        fields[type] = value;
    }

    const year = parseInt(fields.year, 10);
    const hour = parseInt(fields.hour, 10);

    const wallTimestamp = toLocalTimestamp({
        year: fields.era === 'BC' ? 1 - year : year,
        month: parseInt(fields.month, 10),
        day: parseInt(fields.day, 10),
        // Some runtimes have printed midnight as hour 24 even with h23.
        hour: hour === 24 ? 0 : hour,
        minute: parseInt(fields.minute, 10),
        second: parseInt(fields.second, 10),
        millisecond: 0,
    });

    // The parts carry no milliseconds, so compare against the whole second.
    const remainder = instant % 1000;
    const wholeSecond = instant - (remainder >= 0 ? remainder : 1000 + remainder);

    return wallTimestamp - wholeSecond;
}

// Returns the wall-clock fields and offset of the instant in the zone.
function wallFieldsAt(zone, instant) {
    const offset = offsetAt(zone, instant);
    const date = new Date(instant + offset);

    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
        millisecond: date.getUTCMilliseconds(),
        offset,
    };
}

function getPartsFormatter(timeZone) {
    // The fixed shape (English, Gregorian, Latin digits, 24-hour, with era)
    // makes the parts safe to read as numbers.
    return getCachedFormatter(`parts\u0000${ timeZone ?? '' }`, 'en-US', {
        calendar: 'gregory',
        numberingSystem: 'latn',
        hourCycle: 'h23',
        era: 'short',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        timeZone,
    });
}

// Throws whatever the Intl.DateTimeFormat constructor throws.
function getCachedFormatter(key, locale, intlOptions) {
    let formatter = formatterCache.get(key);

    if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, intlOptions);

        if (formatterCache.size >= FORMATTER_CACHE_LIMIT) {
            formatterCache.clear();
        }
        formatterCache.set(key, formatter);
    }

    return formatter;
}

// Returns null when the locale is malformed.
function formatWithIntl(formatName, intlOptions, zone, locale, instant) {
    const resolvedLocale = (typeof locale === 'undefined' || locale === null || locale === '') ? undefined : locale;

    if (typeof resolvedLocale !== 'undefined' && typeof resolvedLocale !== 'string') {
        return null;
    }

    const key = `${ formatName }\u0000${ zone.timeZone ?? '' }\u0000${ resolvedLocale ?? '' }`;

    let formatter;
    try {
        formatter = getCachedFormatter(key, resolvedLocale, { ...intlOptions, timeZone: zone.timeZone });
    } catch {
        // The zone was already accepted and the options are fixed, so the
        // locale is the only thing the constructor can reject.
        return null;
    }

    // Spacing always follows format(). formatToParts() can differ, for example
    // with U+202F before AM/PM where format() prints a plain space.
    const text = formatter.format(instant);

    if (zone.isFixedUTC && intlOptions.timeZoneName) {
        const zoneNamePart = formatter.formatToParts(instant).find(({ type }) => type === 'timeZoneName');

        if (zoneNamePart) {
            // The fixed UTC zone is always named UTC, never
            // "Coordinated Universal Time" or a localized name.
            return text.replace(zoneNamePart.value, 'UTC');
        }
    }

    return text;
}

function formatISO(zone, instant) {
    const fields = wallFieldsAt(zone, instant);
    const { hour, minute, second, millisecond } = fields;
    const time = `${ pad(hour, 2) }:${ pad(minute, 2) }:${ pad(second, 2) }.${ pad(millisecond, 3) }`;

    return `${ isoDateText(fields) }T${ time }${ isoOffsetText(zone, fields.offset) }`;
}

function formatISODate(zone, instant) {
    return isoDateText(wallFieldsAt(zone, instant));
}

function formatISODateTime24(zone, instant) {
    const { year, month, day, hour, minute } = wallFieldsAt(zone, instant);

    return `${ pad(year, 4) }-${ pad(month, 2) }-${ pad(day, 2) } ${ pad(hour, 2) }:${ pad(minute, 2) }`;
}

function formatUTC(_zone, instant) {
    return new Date(instant).toUTCString();
}

// Years outside 0-9999 use the expanded six-digit form, such as +012000.
function isoDateText(fields) {
    const { year, month, day } = fields;
    const isExpanded = year < 0 || year > 9999;
    const yearText = isExpanded ? `${ year < 0 ? '' : '+' }${ pad(year, 6) }` : pad(year, 4);

    return `${ yearText }-${ pad(month, 2) }-${ pad(day, 2) }`;
}

// `Z` marks only the fixed UTC zone. An IANA zone at offset zero, Etc/UTC
// among them, prints +00:00.
function isoOffsetText(zone, offset) {
    if (zone.isFixedUTC) {
        return 'Z';
    }

    const minutes = offset / MINUTE_MS;
    const sign = minutes < 0 ? '-' : '+';
    const absolute = Math.abs(minutes);

    return `${ sign }${ pad(Math.trunc(absolute / 60), 2) }:${ pad(Math.trunc(absolute % 60), 2) }`;
}

function pad(number, length) {
    const digits = String(Math.abs(number)).padStart(length, '0');
    return number < 0 ? `-${ digits }` : digits;
}
