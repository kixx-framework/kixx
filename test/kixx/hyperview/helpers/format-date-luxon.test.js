// Differential test: formatDate on Intl against the v6 luxon helper (TECH-5,
// D42).
//
// TEMPORARY. This file is the compatibility proof that permits deleting the
// vendored luxon. It imports luxon, so it is deleted together with luxon.
//
// On each runtime, the new helper must print exactly what the v6 helper prints
// on that same runtime, for every case in the matrix below, except for four
// accepted deviations. Each deviation is handled by name in its own function.
// Any other difference fails the test with one assertion that lists the count
// and the first 50 differences.
//
// Set FORMAT_DATE_LUXON_REPORT=1 to print the comparison counts on success.
import { describe } from 'kixx-test';
import { assert } from 'kixx-assert';

import * as luxon from '../../../../kixx/vendor/luxon/src/luxon.js';
import * as KixxTemplating from '../../../../kixx/vendor/templating/mod.js';
import { isDate, isNumberNotNaN, toFriendlyString } from '../../../../kixx/assertions/mod.js';

import formatDate from '../../../../kixx/hyperview/helpers/format-date.js';


// -----------------------------------------------------------------------------
// FROZEN v6 REFERENCE
//
// The body of kixx/hyperview/helpers/format-date.js at kixx 63cd4a0a, the last
// version built on luxon 3.7.2. Only the import paths changed, plus one marked
// line that hands the parsed DateTime to the UTC format deviation below.
// Deleted with luxon.
// -----------------------------------------------------------------------------

const { DateTime } = luxon;
const { escapeHTMLChars } = KixxTemplating;

// The DateTime the reference parsed in its last call, or null when the value
// was empty or invalid.
let referenceDateTime = null;

function luxonFormatDate(options, date) {
    referenceDateTime = null;

    if (date === '' || date === null || typeof date === 'undefined') {
        return '';
    }

    const { format, zone, locale } = options;

    let dateTimeOptions;
    if (zone || locale) {
        dateTimeOptions = { zone, locale };
    }

    let dt;
    try {
        if (typeof date === 'string') {
            dt = dateTimeOptions ? DateTime.fromISO(date, dateTimeOptions) : DateTime.fromISO(date);
        } else if (isNumberNotNaN(date)) {
            dt = dateTimeOptions ? DateTime.fromMillis(date, dateTimeOptions) : DateTime.fromMillis(date);
        } else if (isDate(date)) {
            dt = dateTimeOptions ? DateTime.fromJSDate(date, dateTimeOptions) : DateTime.fromJSDate(date);
        } else if (typeof date === 'object') {
            dt = dateTimeOptions ? DateTime.fromObject(date, dateTimeOptions) : DateTime.fromObject(date);
        } else {
            return escapeHTMLChars(`Invalid date ${ toFriendlyString(date) }`);
        }
    } catch (error) {
        return escapeHTMLChars(`Invalid date (${ error.message }) ${ toFriendlyString(date) }`);
    }

    if (dt.invalidReason) {
        return escapeHTMLChars(`Invalid date (${ dt.invalidReason }) ${ toFriendlyString(date) }`);
    }

    referenceDateTime = dt; // Added for the differential test.

    // A full ISO 8601 string
    // Example: 2017-04-22T20:47:05.335-04:00
    if (format === 'ISO') {
        return dt.toISO();
    }

    // The date portion of an ISO 8601 string
    // Example: 2017-04-22
    if (format === 'ISO_DATE') {
        return dt.toISODate();
    }

    // The ISO 8601 date and a 24-hour time, for compact tables
    // Example: 2017-04-22 20:47
    if (format === 'ISO_DATE_TIME_24') {
        return dt.toFormat('yyyy-MM-dd HH:mm');
    }

    // An RFC 2822 string or RFC 7231 string
    // Example: Wed, 14 Jun 2017 07:00:00 GMT
    if (format === 'UTC') {
        return dt.toFormat("ccc, dd MMM yyyy HH:mm:ss 'GMT'");
    }

    if (format === 'DATE_MONTH_DATE') {
        return dt.toLocaleString({ month: 'short', day: 'numeric' });
    }

    if (DateTime[format]) {
        return dt.toLocaleString(DateTime[format]);
    }

    return dt.toLocaleString(DateTime.DATETIME_SHORT);
}

// -----------------------------------------------------------------------------
// MATRIX
// -----------------------------------------------------------------------------

// The four formats with a fixed shape. The other 23 are Intl formats.
const FIXED_SHAPE_FORMATS = [
    'ISO',
    'ISO_DATE',
    'ISO_DATE_TIME_24',
    'UTC',
];

const INTL_FORMATS = [
    'DATE_SHORT',
    'DATE_MED',
    'DATE_MED_WITH_WEEKDAY',
    'DATE_FULL',
    'DATE_HUGE',
    'DATE_MONTH_DATE',
    'TIME_SIMPLE',
    'TIME_WITH_SECONDS',
    'TIME_WITH_SHORT_OFFSET',
    'TIME_WITH_LONG_OFFSET',
    'TIME_24_SIMPLE',
    'TIME_24_WITH_SECONDS',
    'TIME_24_WITH_SHORT_OFFSET',
    'TIME_24_WITH_LONG_OFFSET',
    'DATETIME_SHORT',
    'DATETIME_SHORT_WITH_SECONDS',
    'DATETIME_MED',
    'DATETIME_MED_WITH_SECONDS',
    'DATETIME_MED_WITH_WEEKDAY',
    'DATETIME_FULL',
    'DATETIME_FULL_WITH_SECONDS',
    'DATETIME_HUGE',
    'DATETIME_HUGE_WITH_SECONDS',
];

const FORMATS = [ ...INTL_FORMATS, ...FIXED_SHAPE_FORMATS ];

// undefined means the option is left out.
const ALL_ZONES = [
    undefined,
    'UTC',
    'utc',
    'Etc/UTC',
    'America/New_York',
    'Asia/Kolkata',
    'Australia/Sydney',
];

// Years far from today only in zones without local mean time offsets.
const UTC_ZONES = [ 'UTC', 'utc', 'Etc/UTC' ];

const ERROR_ZONES = [ undefined, 'America/New_York' ];

// Every locale runs with every format, the fixed-shape ones included, so the
// ISO_DATE_TIME_24 digits deviation and the UTC format's locale independence
// are both exercised.
const LOCALES = [
    undefined,
    'en-US',
    'en-GB',
    'de-DE',
    'fr-FR',
    'ja-JP',
    'ar-EG',
];

const GENERAL_INPUTS = [
    // Z and offset strings
    '1983-10-14T13:30:23.000Z',
    '2017-04-22T20:47:05.335-04:00',
    '2017-04-22T10:30:15,5+05:30',
    '20170422T103015Z',
    '2017-01-01T00:00:00Z',
    '2017-04-22T24:00:00Z',
    '2017-04-22T10:30:00.123456789Z',
    '2017-04-22t10:30z',
    // Offset-less strings
    '2017-04-22',
    '2017-04',
    '2017',
    '201704',
    '2017-04-22T10',
    '2017-04-22T10:30',
    '2017-04-22T10:30:15.250',
    '2017-04-22T24:00',
    // DST gaps in New York and in Sydney
    '2017-03-12T02:30',
    '2017-10-01T02:30',
    // Timestamps
    0,
    1e12,
    -1e12,
    1.5,
    // Date
    new Date('1983-10-14T13:30:23.000Z'),
    // Date-part objects
    { year: 1983, month: 10, day: 14 },
    { year: 1983, month: 10, day: 14, hour: 13, minute: 30, second: 23, millisecond: 5 },
    { year: 2017 },
    { year: 2017, month: null, day: 5 },
    { year: 2017, month: 3, day: 12, hour: 2, minute: 30 },
];

const YEAR_INPUTS = [
    '0099-01-01T00:00:00Z',
    '-000044-03-15T00:00:00Z',
    '+012000-01-01T00:00:00Z',
    { year: 99, month: 1, day: 1 },
    { year: -44, month: 3, day: 15 },
    8.64e15,
    -8.64e15,
];

// Each has exactly one fault.
const ERROR_INPUTS = [
    'not-a-date',
    ' 2017-04-22',
    '2017-02-30',
    '2017-04-22T25:00',
    '2017-04-22T10:30.5',
    '2017-04-22T24:00:00.001',
    8.64e15 + 1,
    new Date(NaN),
    { yr: 1 },
    { year: true },
    { year: '' },
    { year: 1.5 },
    { year: 2017, month: 13 },
    '+275761-01-01T00:00Z',
];

const UNSUPPORTED_ZONE_INPUTS = [ '1983-10-14T13:30:23.000Z' ];

function* matrixCases() {
    const groups = [
        [ GENERAL_INPUTS, ALL_ZONES ],
        [ YEAR_INPUTS, UTC_ZONES ],
        [ ERROR_INPUTS, ERROR_ZONES ],
        [ UNSUPPORTED_ZONE_INPUTS, [ 'Nope/Zone' ] ],
    ];

    for (const [ inputs, zones ] of groups) {
        for (const input of inputs) {
            for (const zone of zones) {
                for (const locale of LOCALES) {
                    for (const format of FORMATS) {
                        yield { format, zone, locale, input };
                    }
                }
            }
        }
    }
}

function buildOptions({ format, zone, locale }) {
    const options = { format };
    if (typeof zone !== 'undefined') {
        options.zone = zone;
    }
    if (typeof locale !== 'undefined') {
        options.locale = locale;
    }
    return options;
}

function runReference(options, input) {
    try {
        return luxonFormatDate(options, input);
    } catch (error) {
        referenceDateTime = null;
        return `REFERENCE THREW ${ error.name }: ${ error.message }`;
    }
}

function runHelper(options, input) {
    try {
        return formatDate(null, options, input);
    } catch (error) {
        return `HELPER THREW ${ error.name }: ${ error.message }`;
    }
}

// -----------------------------------------------------------------------------
// ACCEPTED DEVIATIONS
//
// Each returns { pass, changed }. `pass` says whether the new output is
// acceptable. `changed` says whether the deviation made a difference: the
// plain comparison would have failed.
// -----------------------------------------------------------------------------

// The UTC format is fixed: the RFC 7231 HTTP-date of the instant, identical to
// Date.prototype.toUTCString(), whatever the zone and locale. v6 printed the
// zone's wall time labelled GMT, with localized names. That was a bug.
// Compares against the instant luxon parsed, so parsing is still checked.
function allowUTCFormat(ours, luxonOutput, luxonInstant) {
    return {
        pass: ours === luxonInstant.toUTCString(),
        changed: ours !== luxonOutput,
    };
}

const NARROW_NO_BREAK_SPACE = /\u202F/g;

// In the fixed UTC zone (`UTC`, `utc`), luxon joins formatToParts() output,
// which on Node.js puts U+202F before AM/PM. The new helper always follows
// Intl.DateTimeFormat#format(), which puts U+0020 there, as luxon itself does
// for Etc/UTC and on Deno. Both sides are normalized so a U+202F that format()
// emits on its own can't cause a false difference.
function allowFixedUTCSpacing(ours, luxonOutput) {
    const normalizedLuxon = luxonOutput.replace(NARROW_NO_BREAK_SPACE, ' ');
    return {
        pass: ours.replace(NARROW_NO_BREAK_SPACE, ' ') === normalizedLuxon,
        changed: normalizedLuxon !== luxonOutput && ours !== luxonOutput,
    };
}

// ISO_DATE_TIME_24 is a fixed-shape format for machines and compact tables, so
// its digits are always ASCII. Luxon localized them for locales such as ar-EG.
// Compares against luxon's output for the same input and zone in en-US.
function allowASCIIDigits(ours, luxonOutput, options, input) {
    const asciiLuxon = runReference({ ...options, locale: 'en-US' }, input);
    return {
        pass: ours === asciiLuxon,
        changed: ours !== luxonOutput,
    };
}

// A timestamp with a fractional millisecond is truncated once, like
// new Date(ms), so one instant shows the same millisecond in every zone. Luxon
// truncates after adding the zone offset, so when the wall time falls on the
// other side of 1970-01-01T00:00 from the instant it shows a different
// millisecond (1.5 prints .001 in UTC but .002 in America/New_York).
// Compares against luxon's output for the instant truncated once, with the
// same format, zone, and locale; the other deviations still apply.
function isFractionalTimestamp(input) {
    return typeof input === 'number' && Number.isFinite(input) && !Number.isInteger(input);
}

const FIXED_UTC_ZONES = new Set([ 'UTC', 'utc' ]);
const INTL_FORMAT_SET = new Set(INTL_FORMATS);

// Compares the helper's output for the case's input with the reference's
// output for referenceInput, applying the deviations that depend on format,
// zone, and locale.
function compareWithReference(testCase, options, ours, referenceInput) {
    const luxonOutput = runReference(options, referenceInput);
    const luxonDateTime = referenceDateTime;

    const { format, zone, locale } = testCase;

    if (format === 'UTC' && luxonDateTime) {
        return { deviation: 'utcFormat', luxonOutput, ...allowUTCFormat(ours, luxonOutput, luxonDateTime.toJSDate()) };
    }
    if (FIXED_UTC_ZONES.has(zone) && INTL_FORMAT_SET.has(format)) {
        return { deviation: 'fixedUTCSpacing', luxonOutput, ...allowFixedUTCSpacing(ours, luxonOutput) };
    }
    if (format === 'ISO_DATE_TIME_24' && locale) {
        return { deviation: 'asciiDigits', luxonOutput, ...allowASCIIDigits(ours, luxonOutput, options, referenceInput) };
    }

    return { deviation: null, luxonOutput, pass: ours === luxonOutput, changed: false };
}

function compareCase(testCase) {
    const options = buildOptions(testCase);
    const ours = runHelper(options, testCase.input);
    const direct = compareWithReference(testCase, options, ours, testCase.input);

    if (!isFractionalTimestamp(testCase.input)) {
        return { ...direct, ours, fractional: null };
    }

    const truncated = compareWithReference(testCase, options, ours, new Date(testCase.input).getTime());

    return {
        ...truncated,
        // Report luxon's own output for the original input on failure.
        luxonOutput: direct.luxonOutput,
        ours,
        fractional: { pass: truncated.pass, changed: !direct.pass },
    };
}

function describeInput(input) {
    if (isDate(input)) {
        return `Date(${ Number.isNaN(input.getTime()) ? 'NaN' : input.toISOString() })`;
    }
    return JSON.stringify(input);
}

function tally(counter, result) {
    counter.routed += 1;
    if (result.pass && result.changed) {
        counter.changed += 1;
    }
}

function runMatrix() {
    const counts = {
        comparisons: 0,
        deviations: {
            utcFormat: { routed: 0, changed: 0 },
            fixedUTCSpacing: { routed: 0, changed: 0 },
            asciiDigits: { routed: 0, changed: 0 },
            fractionalMillisecond: { routed: 0, changed: 0 },
        },
    };
    const differences = [];

    for (const testCase of matrixCases()) {
        counts.comparisons += 1;
        const result = compareCase(testCase);

        if (result.deviation) {
            tally(counts.deviations[result.deviation], result);
        }
        if (result.fractional) {
            tally(counts.deviations.fractionalMillisecond, result.fractional);
        }

        if (!result.pass) {
            differences.push({
                format: testCase.format,
                zone: testCase.zone,
                locale: testCase.locale,
                input: describeInput(testCase.input),
                luxon: result.luxonOutput,
                ours: result.ours,
            });
        }
    }

    return { counts, differences };
}

function reportRequested() {
    const env = globalThis.process?.env;
    return Boolean(env && env.FORMAT_DATE_LUXON_REPORT);
}


describe('formatDate compared with the v6 luxon helper', ({ it }) => {

    it('prints what luxon prints, apart from the accepted deviations', () => {
        const { counts, differences } = runMatrix();

        if (reportRequested()) {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({
                zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
                ...counts,
            }));
        }

        assert(counts.comparisons > 0, 'The matrix is empty');

        const listing = differences
            .slice(0, 50)
            .map((difference) => JSON.stringify(difference))
            .join('\n');

        assert(
            differences.length === 0,
            `${ differences.length } unexpected differences in ${ counts.comparisons } comparisons:\n${ listing }\n`,
        );
    });
});
