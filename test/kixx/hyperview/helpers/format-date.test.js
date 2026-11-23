// Golden tests for formatDate on Intl.DateTimeFormat (TECH-5, D42).
//
// Every expected string is fixed, except where a test is about the host's own
// zone or locale; those compute the expected value from the host, so the suite
// passes in any time zone and default locale.
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import formatDate from '../../../../kixx/hyperview/helpers/format-date.js';


// The helper signature is (context, options, ...positionals). The named options
// carry the format, zone, and locale.
function render(date, options) {
    return formatDate(null, options ?? {}, date);
}

function renderISO(date, zone) {
    return render(date, { format: 'ISO', zone });
}

// October 14, 1983 at 13:30:23 in America/New_York.
const INSTANT = '1983-10-14T13:30:23.000-04:00';

const NEW_YORK_EN_US = { zone: 'America/New_York', locale: 'en-US' };

const GOLDEN_STRINGS = [
    [ 'DATE_SHORT', '10/14/1983' ],
    [ 'DATE_MED', 'Oct 14, 1983' ],
    [ 'DATE_MED_WITH_WEEKDAY', 'Fri, Oct 14, 1983' ],
    [ 'DATE_FULL', 'October 14, 1983' ],
    [ 'DATE_HUGE', 'Friday, October 14, 1983' ],
    [ 'DATE_MONTH_DATE', 'Oct 14' ],
    [ 'TIME_SIMPLE', '1:30 PM' ],
    [ 'TIME_WITH_SECONDS', '1:30:23 PM' ],
    [ 'TIME_WITH_SHORT_OFFSET', '1:30:23 PM EDT' ],
    [ 'TIME_WITH_LONG_OFFSET', '1:30:23 PM Eastern Daylight Time' ],
    [ 'TIME_24_SIMPLE', '13:30' ],
    [ 'TIME_24_WITH_SECONDS', '13:30:23' ],
    [ 'TIME_24_WITH_SHORT_OFFSET', '13:30:23 EDT' ],
    [ 'TIME_24_WITH_LONG_OFFSET', '13:30:23 Eastern Daylight Time' ],
    [ 'DATETIME_SHORT', '10/14/1983, 1:30 PM' ],
    [ 'DATETIME_SHORT_WITH_SECONDS', '10/14/1983, 1:30:23 PM' ],
    [ 'DATETIME_MED', 'Oct 14, 1983, 1:30 PM' ],
    [ 'DATETIME_MED_WITH_SECONDS', 'Oct 14, 1983, 1:30:23 PM' ],
    [ 'DATETIME_MED_WITH_WEEKDAY', 'Fri, Oct 14, 1983, 1:30 PM' ],
    [ 'DATETIME_FULL', 'October 14, 1983 at 1:30 PM EDT' ],
    [ 'DATETIME_FULL_WITH_SECONDS', 'October 14, 1983 at 1:30:23 PM EDT' ],
    [ 'DATETIME_HUGE', 'Friday, October 14, 1983 at 1:30 PM Eastern Daylight Time' ],
    [ 'DATETIME_HUGE_WITH_SECONDS', 'Friday, October 14, 1983 at 1:30:23 PM Eastern Daylight Time' ],
    [ 'ISO', '1983-10-14T13:30:23.000-04:00' ],
    [ 'ISO_DATE', '1983-10-14' ],
    [ 'ISO_DATE_TIME_24', '1983-10-14 13:30' ],
    [ 'UTC', 'Fri, 14 Oct 1983 17:30:23 GMT' ],
];


describe('formatDate helper', ({ describe }) => {

    describe('every format in en-US and America/New_York', ({ it }) => {

        it('covers all 27 formats', () => {
            assertEqual(27, GOLDEN_STRINGS.length);
        });

        for (const [ format, expected ] of GOLDEN_STRINGS) {
            it(`formats ${ format }`, () => {
                assertEqual(expected, render(INSTANT, { ...NEW_YORK_EN_US, format }));
            });
        }

        it('accepts a v6 preset name as the format', () => {
            assertEqual('October 14, 1983', render(INSTANT, { ...NEW_YORK_EN_US, format: 'DATE_FULL' }));
        });
    });

    describe('default format', ({ it }) => {

        it('uses DATETIME_SHORT when the format is omitted', () => {
            assertEqual('10/14/1983, 1:30 PM', render(INSTANT, NEW_YORK_EN_US));
        });

        it('uses DATETIME_SHORT when the format is empty', () => {
            assertEqual('10/14/1983, 1:30 PM', render(INSTANT, { ...NEW_YORK_EN_US, format: '' }));
        });
    });

    describe('unknown format', ({ it }) => {

        it('renders a message in place of the date', () => {
            assertEqual('Unknown date format String(NOPE)', render(INSTANT, { format: 'NOPE' }));
        });

        it('does not treat Object.prototype names as formats', () => {
            assertEqual('Unknown date format String(toString)', render(INSTANT, { format: 'toString' }));
            assertEqual('Unknown date format String(constructor)', render(INSTANT, { format: 'constructor' }));
            assertEqual('Unknown date format String(__proto__)', render(INSTANT, { format: '__proto__' }));
        });

        it('matches format names case-sensitively', () => {
            assertEqual('Unknown date format String(iso)', render(INSTANT, { format: 'iso' }));
        });

        it('escapes the format name', () => {
            assertEqual('Unknown date format String(&lt;b&gt;)', render(INSTANT, { format: '<b>' }));
        });

        it('reports a non-string format', () => {
            assertEqual('Unknown date format Number(5)', render(INSTANT, { format: 5 }));
        });
    });

    describe('fixed UTC zone', ({ it }) => {

        it('ends ISO with Z for UTC, utc, and GMT', () => {
            assertEqual('1983-10-14T17:30:23.000Z', renderISO(INSTANT, 'UTC'));
            assertEqual('1983-10-14T17:30:23.000Z', renderISO(INSTANT, 'utc'));
            assertEqual('1983-10-14T17:30:23.000Z', renderISO(INSTANT, 'GMT'));
        });

        it('names the zone UTC in short and long zone names', () => {
            const options = { zone: 'UTC', locale: 'en-US' };

            assertEqual('5:30:23 PM UTC', render(INSTANT, { ...options, format: 'TIME_WITH_SHORT_OFFSET' }));
            assertEqual('5:30:23 PM UTC', render(INSTANT, { ...options, format: 'TIME_WITH_LONG_OFFSET' }));
            assertEqual('Friday, October 14, 1983 at 5:30 PM UTC', render(INSTANT, { ...options, format: 'DATETIME_HUGE' }));
        });

        it('treats Etc/UTC as an ordinary zone', () => {
            assertEqual('1983-10-14T17:30:23.000+00:00', renderISO(INSTANT, 'Etc/UTC'));
            assertEqual('5:30:23 PM Coordinated Universal Time', render(INSTANT, {
                zone: 'Etc/UTC',
                locale: 'en-US',
                format: 'TIME_WITH_LONG_OFFSET',
            }));
        });
    });

    describe('ISO strings', ({ it }) => {

        const accepted = [
            // Calendar dates, extended and basic
            [ '2017-04-22', '2017-04-22T00:00:00.000Z' ],
            [ '20170422', '2017-04-22T00:00:00.000Z' ],
            [ '2017-0422', '2017-04-22T00:00:00.000Z' ],
            [ '201704-22', '2017-04-22T00:00:00.000Z' ],
            [ '2017-04', '2017-04-01T00:00:00.000Z' ],
            [ '201704', '2017-04-01T00:00:00.000Z' ],
            [ '2017', '2017-01-01T00:00:00.000Z' ],
            // Times, extended and basic
            [ '2017-04-22T10', '2017-04-22T10:00:00.000Z' ],
            [ '2017-04-22T10:30', '2017-04-22T10:30:00.000Z' ],
            [ '2017-04-22T1030', '2017-04-22T10:30:00.000Z' ],
            [ '2017-04-22T10:30:15', '2017-04-22T10:30:15.000Z' ],
            [ '2017-04-22T103015', '2017-04-22T10:30:15.000Z' ],
            [ '20170422T103015Z', '2017-04-22T10:30:15.000Z' ],
            [ '2017-04-22t10:30z', '2017-04-22T10:30:00.000Z' ],
            // Fractions are floored to milliseconds
            [ '2017-04-22T10:30:15.250', '2017-04-22T10:30:15.250Z' ],
            [ '2017-04-22T10:30:15,5', '2017-04-22T10:30:15.500Z' ],
            [ '2017-04-22T10:30:15.123456789', '2017-04-22T10:30:15.123Z' ],
            [ '2017-04-22T10:30:15.999999999', '2017-04-22T10:30:15.999Z' ],
            [ `2017-04-22T10:30:15.${ '1'.repeat(30) }`, '2017-04-22T10:30:15.111Z' ],
            // Offsets, which are not range checked
            [ '2017-04-22T10:30Z', '2017-04-22T10:30:00.000Z' ],
            [ '2017-04-22T10:30+05', '2017-04-22T05:30:00.000Z' ],
            [ '2017-04-22T10:30+0530', '2017-04-22T05:00:00.000Z' ],
            [ '2017-04-22T10:30+05:30', '2017-04-22T05:00:00.000Z' ],
            [ '2017-04-22T10:30-05:30', '2017-04-22T16:00:00.000Z' ],
            [ '2017-04-22T10:30-00:30', '2017-04-22T11:00:00.000Z' ],
            [ '2017-04-22T10:30+25:00', '2017-04-21T09:30:00.000Z' ],
            // Hour 24 is the end of the day
            [ '2017-04-22T24', '2017-04-23T00:00:00.000Z' ],
            [ '2017-04-22T24:00', '2017-04-23T00:00:00.000Z' ],
            [ '2017-04-22T24:00:00', '2017-04-23T00:00:00.000Z' ],
            [ '2017-04-22T24:00:00.000', '2017-04-23T00:00:00.000Z' ],
            [ '2017-12-31T24:00:00', '2018-01-01T00:00:00.000Z' ],
            // Leap day, two-digit, expanded, and negative years
            [ '2016-02-29', '2016-02-29T00:00:00.000Z' ],
            [ '0099-01-01T00:00:00Z', '0099-01-01T00:00:00.000Z' ],
            [ '+002017-04-22', '2017-04-22T00:00:00.000Z' ],
            [ '+012000-01-01T00:00:00Z', '+012000-01-01T00:00:00.000Z' ],
            [ '-000044-03-15T00:00:00Z', '-000044-03-15T00:00:00.000Z' ],
        ];

        for (const [ input, expected ] of accepted) {
            it(`reads ${ input }`, () => {
                assertEqual(expected, renderISO(input, 'UTC'));
            });
        }

        it('shows a Z instant in the requested zone', () => {
            assertEqual('1983-10-14T09:30:23.000-04:00', renderISO('1983-10-14T13:30:23Z', 'America/New_York'));
        });

        it('shows an offset instant in the requested zone', () => {
            assertEqual('2017-04-22T20:00:00.000+05:30', renderISO('2017-04-22T10:30-04:00', 'Asia/Kolkata'));
        });

        it('renders the requested zone rather than the host zone', () => {
            const justAfterMidnight = '1983-10-14T02:00:00.000Z';

            assertEqual('1983-10-14', render(justAfterMidnight, { format: 'ISO_DATE', zone: 'UTC' }));
            assertEqual('1983-10-13', render(justAfterMidnight, { format: 'ISO_DATE', zone: 'America/New_York' }));
        });
    });

    describe('wall-clock time in a zone', ({ it }) => {

        it('reads an offset-less date as midnight in the zone', () => {
            assertEqual('2017-04-22T00:00:00.000-04:00', renderISO('2017-04-22', 'America/New_York'));
        });

        it('reads an offset-less date-time in a zone with a half-hour offset', () => {
            assertEqual('2017-04-22T10:30:00.000+05:30', renderISO('2017-04-22T10:30', 'Asia/Kolkata'));
        });

        it('reads date parts as wall-clock time in the zone', () => {
            assertEqual('1983-10-14T00:00:00.000-04:00', renderISO({ year: 1983, month: 10, day: 14 }, 'America/New_York'));
        });

        it('resolves a repeated New York time to the earlier occurrence', () => {
            assertEqual('2017-11-05T01:30:00.000-04:00', renderISO('2017-11-05T01:30', 'America/New_York'));
        });

        it('resolves a repeated Sydney time to the earlier occurrence', () => {
            assertEqual('2017-04-02T02:30:00.000+11:00', renderISO('2017-04-02T02:30', 'Australia/Sydney'));
        });

        it('moves a skipped New York time forward by the gap', () => {
            assertEqual('2017-03-12T03:30:00.000-04:00', renderISO('2017-03-12T02:30', 'America/New_York'));
        });

        it('moves a skipped Sydney time forward by the gap', () => {
            assertEqual('2017-10-01T03:30:00.000+11:00', renderISO('2017-10-01T02:30', 'Australia/Sydney'));
        });

        it('resolves a skipped time in date parts the same way', () => {
            const parts = { year: 2017, month: 3, day: 12, hour: 2, minute: 30 };

            assertEqual('2017-03-12T03:30:00.000-04:00', renderISO(parts, 'America/New_York'));
        });
    });

    describe('date-part objects', ({ it }) => {

        it('reads every unit', () => {
            const parts = { year: 1983, month: 10, day: 14, hour: 13, minute: 30, second: 23, millisecond: 5 };

            assertEqual('1983-10-14T13:30:23.005Z', renderISO(parts, 'UTC'));
        });

        it('defaults missing smaller units to their minimum', () => {
            assertEqual('2017-01-01T00:00:00.000Z', renderISO({ year: 2017 }, 'UTC'));
        });

        it('counts a null or undefined value as missing', () => {
            assertEqual('2017-01-05T00:00:00.000Z', renderISO({ year: 2017, month: null, day: 5 }, 'UTC'));
            assertEqual('2017-01-05T00:00:00.000Z', renderISO({ year: 2017, month: undefined, day: 5 }, 'UTC'));
        });

        it('reads years 0 to 99 as real years', () => {
            assertEqual('0099-01-01T00:00:00.000Z', renderISO({ year: 99, month: 1, day: 1 }, 'UTC'));
        });

        it('reads negative years', () => {
            assertEqual('-000044-03-15T00:00:00.000Z', renderISO({ year: -44, month: 3, day: 15 }, 'UTC'));
        });

        it('requires a year', () => {
            assertEqual('Invalid date (missing year) Object({})', renderISO({}, 'UTC'));
            assertEqual('Invalid date (missing year) Object({})', renderISO({ month: 3, day: 1 }, 'UTC'));
            assertEqual('Invalid date (missing year) Object({})', renderISO({ year: null }, 'UTC'));
        });

        it('rejects any other key spelling', () => {
            assertEqual('Invalid date (Invalid unit Year) Object({})', renderISO({ Year: 2017 }, 'UTC'));
            assertEqual('Invalid date (Invalid unit years) Object({})', renderISO({ years: 2017 }, 'UTC'));
            assertEqual('Invalid date (Invalid unit yr) Object({})', renderISO({ yr: 1 }, 'UTC'));
        });

        it('rejects week and quarter keys', () => {
            assertEqual('Invalid date (Invalid unit weekYear) Object({})', renderISO({ weekYear: 2017 }, 'UTC'));
            assertEqual('Invalid date (Invalid unit quarter) Object({})', renderISO({ quarter: 2 }, 'UTC'));
        });

        it('rejects values which are not finite numbers', () => {
            assertEqual('Invalid date (Invalid unit value 2017) Object({})', renderISO({ year: '2017' }, 'UTC'));
            assertEqual('Invalid date (Invalid unit value ) Object({})', renderISO({ year: '' }, 'UTC'));
            assertEqual('Invalid date (Invalid unit value true) Object({})', renderISO({ year: true }, 'UTC'));
            assertEqual('Invalid date (Invalid unit value Infinity) Object({})', renderISO({ year: Infinity }, 'UTC'));
        });

        it('checks keys before values', () => {
            assertEqual('Invalid date (Invalid unit yr) Object({})', renderISO({ year: 'x', yr: 1 }, 'UTC'));
        });

        it('rejects units out of range', () => {
            assertEqual('Invalid date (unit out of range) Object({})', renderISO({ year: 1.5 }, 'UTC'));
            assertEqual('Invalid date (unit out of range) Object({})', renderISO({ year: 2017, month: 13 }, 'UTC'));
            assertEqual('Invalid date (unit out of range) Object({})', renderISO({ year: 2017, month: 2, day: 29 }, 'UTC'));
            assertEqual('Invalid date (unit out of range) Object({})', renderISO({ year: 2017, hour: 24, minute: 1 }, 'UTC'));
        });

        it('rejects a year outside the Date range', () => {
            assertEqual('Invalid date (invalid input) Object({})', renderISO({ year: 300000 }, 'UTC'));
        });
    });

    describe('timestamps and Date instances', ({ it }) => {

        it('formats the epoch', () => {
            assertEqual('1970-01-01T00:00:00.000Z', renderISO(0, 'UTC'));
        });

        it('formats the ends of the Date range', () => {
            assertEqual('+275760-09-13T00:00:00.000Z', renderISO(8.64e15, 'UTC'));
            assertEqual('-271821-04-20T00:00:00.000Z', renderISO(-8.64e15, 'UTC'));
        });

        it('rejects a timestamp outside the Date range', () => {
            assertEqual('Invalid date (Timestamp out of range) Number(8640000000000001)', renderISO(8.64e15 + 1, 'UTC'));
        });

        it('truncates fractional milliseconds like Date', () => {
            assertEqual('1970-01-01T00:00:00.001Z', renderISO(1.5, 'UTC'));
            assertEqual('1969-12-31T23:59:59.999Z', renderISO(-1.5, 'UTC'));
        });

        it('formats a Date', () => {
            assertEqual('1983-10-14T17:30:23.000Z', renderISO(new Date(INSTANT), 'UTC'));
        });

        it('rejects an instant whose wall time in the zone is outside the Date range', () => {
            assertEqual('Invalid date (invalid input) Number(8640000000000000)', render(8.64e15, {
                zone: 'Asia/Kolkata',
                locale: 'en-US',
            }));
        });
    });

    describe('zones', ({ it }) => {

        it('accepts an IANA name in any case', () => {
            assertEqual('1983-10-14T13:30:23.000-04:00', renderISO(INSTANT, 'america/new_york'));
        });

        it('accepts an alias', () => {
            assertEqual('1983-10-14T13:30:23.000-04:00', renderISO(INSTANT, 'US/Eastern'));
        });

        it('rejects names Intl does not know', () => {
            assertEqual('Invalid date (unsupported zone) String(1983-10-14T13:30:23.000-04:00)', renderISO(INSTANT, 'Nope/Zone'));
        });

        it('rejects zone aliases and fixed offsets', () => {
            assertEqual('Invalid date (unsupported zone) String(1983-10-14T13:30:23.000-04:00)', renderISO(INSTANT, 'local'));
            assertEqual('Invalid date (unsupported zone) String(1983-10-14T13:30:23.000-04:00)', renderISO(INSTANT, 'system'));
            assertEqual('Invalid date (unsupported zone) String(1983-10-14T13:30:23.000-04:00)', renderISO(INSTANT, 'UTC+3'));
            assertEqual('Invalid date (unsupported zone) String(1983-10-14T13:30:23.000-04:00)', renderISO(INSTANT, 5));
        });

        it('names the date value, escaped, when the zone is unsupported', () => {
            assertEqual('Invalid date (unsupported zone) String(&lt;b&gt;)', renderISO('<b>', '<script>'));
        });
    });

    describe('diagnostics', ({ it }) => {

        const unparsable = [
            'not-a-date',
            ' 2017-04-22',
            '2017-04-22 10:30',
            '2017-04-22Z',
            '2017-04-22T10:30.5',
            `2017-04-22T10:30:15.${ '1'.repeat(31) }`,
            // Week dates, ordinal dates, time-only strings, and bracketed zones
            '2017-W16-6',
            '2017-112',
            '10:30',
            '2017-04-22T10:30[America/New_York]',
        ];

        for (const input of unparsable) {
            it(`reports ${ JSON.stringify(input) } as unparsable`, () => {
                assertEqual(`Invalid date (unparsable) String(${ input })`, renderISO(input, 'UTC'));
            });
        }

        const outOfRange = [
            '2017-13-01',
            '2017-00-10',
            '2017-02-30',
            '2017-04-22T25:00',
            '2017-04-22T10:60',
            '2017-04-22T10:30:60',
            '2017-04-22T24:01',
            '2017-04-22T24:00:00.001',
            // Thirty nines round to a whole second before flooring.
            `2017-04-22T10:30:15.${ '9'.repeat(30) }`,
        ];

        for (const input of outOfRange) {
            it(`reports ${ input } as out of range`, () => {
                assertEqual(`Invalid date (unit out of range) String(${ input })`, renderISO(input, 'UTC'));
            });
        }

        it('reports a string instant outside the Date range as invalid input', () => {
            assertEqual('Invalid date (invalid input) String(+275761-01-01T00:00Z)', renderISO('+275761-01-01T00:00Z', 'UTC'));
        });

        it('reports an invalid Date as invalid input', () => {
            assertEqual('Invalid date (invalid input) Date(Invalid)', renderISO(new Date(NaN), 'UTC'));
        });

        it('reports objects which are not plain as invalid input', () => {
            class Moment {}

            assertEqual('Invalid date (invalid input) Array([0..0])', renderISO([ 2017 ], 'UTC'));
            assertEqual('Invalid date (invalid input) Map()', renderISO(new Map(), 'UTC'));
            assertEqual('Invalid date (invalid input) Moment([object Object])', renderISO(new Moment(), 'UTC'));
        });

        it('reports values of a type which is never a date', () => {
            assertEqual('Invalid date Boolean(true)', renderISO(true, 'UTC'));
            assertEqual('Invalid date Number(NaN)', renderISO(NaN, 'UTC'));
            assertEqual('Invalid date BigInt(10)', renderISO(10n, 'UTC'));
            assertEqual('Invalid date Symbol(x)', renderISO(Symbol('x'), 'UTC'));
            assertEqual('Invalid date Function(function)', renderISO(() => 1, 'UTC'));
        });

        it('reports an unexpected error with its message', () => {
            const parts = {
                get year() {
                    throw new Error('<boom>');
                },
            };

            assertEqual('Invalid date (&lt;boom&gt;) Object({})', renderISO(parts, 'UTC'));
        });

        it('escapes the value', () => {
            assertEqual('Invalid date (unparsable) String(&lt;script&gt;alert(1)&lt;/script&gt;)', renderISO('<script>alert(1)</script>', 'UTC'));
        });

        it('checks the zone before the value', () => {
            assertEqual('Invalid date (unsupported zone) String(not-a-date)', renderISO('not-a-date', 'Nope/Zone'));
        });
    });

    describe('the UTC format', ({ it }) => {

        it('ignores zone and locale', () => {
            const expected = 'Fri, 14 Oct 1983 17:30:23 GMT';

            assertEqual(expected, render(INSTANT, { format: 'UTC', zone: 'America/New_York', locale: 'de-DE' }));
            assertEqual(expected, render(INSTANT, { format: 'UTC', zone: 'Asia/Kolkata', locale: 'ja-JP' }));
            assertEqual(expected, render(INSTANT, { format: 'UTC' }));
        });

        it('equals Date#toUTCString()', () => {
            for (const input of [ 0, 1e12, -1e12, Date.parse('0099-01-01T00:00:00Z') ]) {
                assertEqual(new Date(input).toUTCString(), render(input, { format: 'UTC', zone: 'Australia/Sydney' }));
            }

            for (const input of [ 8.64e15, -8.64e15 ]) {
                assertEqual(new Date(input).toUTCString(), render(input, { format: 'UTC', zone: 'UTC' }));
            }
        });
    });

    describe('fixed-shape formats', ({ it }) => {

        it('prints ASCII digits whatever the locale', () => {
            assertEqual('1983-10-14 13:30', render(INSTANT, { ...NEW_YORK_EN_US, locale: 'ar-EG', format: 'ISO_DATE_TIME_24' }));
            assertEqual('1983-10-14T13:30:23.000-04:00', render(INSTANT, { ...NEW_YORK_EN_US, locale: 'ar-EG', format: 'ISO' }));
        });

        it('pads ISO_DATE_TIME_24 years to four digits', () => {
            assertEqual('0099-01-01 00:00', render('0099-01-01T00:00:00Z', { format: 'ISO_DATE_TIME_24', zone: 'UTC' }));
            assertEqual('-0044-03-15 00:00', render('-000044-03-15T00:00:00Z', { format: 'ISO_DATE_TIME_24', zone: 'UTC' }));
            assertEqual('12000-01-01 00:00', render('+012000-01-01T00:00:00Z', { format: 'ISO_DATE_TIME_24', zone: 'UTC' }));
        });

        it('uses the expanded year form for ISO_DATE outside 0 to 9999', () => {
            assertEqual('+012000-01-01', render('+012000-01-01T00:00:00Z', { format: 'ISO_DATE', zone: 'UTC' }));
            assertEqual('-000044-03-15', render('-000044-03-15T00:00:00Z', { format: 'ISO_DATE', zone: 'UTC' }));
        });
    });

    describe('locales', ({ it }) => {

        it('renders a message for a malformed locale', () => {
            assertEqual('Invalid locale String(en_US)', render(INSTANT, { ...NEW_YORK_EN_US, locale: 'en_US', format: 'DATE_MED' }));
        });

        it('ignores a malformed locale for formats which do not use it', () => {
            assertEqual('1983-10-14T13:30:23.000-04:00', render(INSTANT, { ...NEW_YORK_EN_US, locale: 'en_US', format: 'ISO' }));
        });

        it('escapes the locale', () => {
            assertEqual('Invalid locale String(&lt;b&gt;)', render(INSTANT, { ...NEW_YORK_EN_US, locale: '<b>', format: 'DATE_MED' }));
        });

        it('reports a non-string locale', () => {
            assertEqual('Invalid locale Number(5)', render(INSTANT, { ...NEW_YORK_EN_US, locale: 5, format: 'DATE_MED' }));
        });

        it('formats in the requested locale', () => {
            assertEqual('14. Oktober 1983', render(INSTANT, { ...NEW_YORK_EN_US, locale: 'de-DE', format: 'DATE_FULL' }));
        });

        it('falls back silently for a well-formed but unknown locale', () => {
            const expected = new Intl.DateTimeFormat('zz-ZZ', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
                .format(new Date(INSTANT));

            assertEqual(expected, render(INSTANT, { ...NEW_YORK_EN_US, locale: 'zz-ZZ', format: 'DATE_MED' }));
        });
    });

    describe('host zone', ({ it }) => {

        it('reads an offset-less date-time as wall-clock time in the host zone', () => {
            assertEqual('2017-04-22 10:30', render('2017-04-22T10:30', { format: 'ISO_DATE_TIME_24' }));
        });

        it('prints the host offset for local midnight', () => {
            const offsetMinutes = -new Date(2017, 3, 22).getTimezoneOffset();
            const sign = offsetMinutes < 0 ? '-' : '+';
            const hours = String(Math.trunc(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
            const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');

            assertEqual(`2017-04-22T00:00:00.000${ sign }${ hours }:${ minutes }`, render('2017-04-22', { format: 'ISO' }));
        });

        it('shows an instant in the host zone', () => {
            const date = new Date('2017-04-22T10:30:00Z');
            const pad = (n) => String(n).padStart(2, '0');
            const expected = `${ date.getFullYear() }-${ pad(date.getMonth() + 1) }-${ pad(date.getDate()) } ${ pad(date.getHours()) }:${ pad(date.getMinutes()) }`;

            assertEqual(expected, render('2017-04-22T10:30:00Z', { format: 'ISO_DATE_TIME_24' }));
        });

        it('treats an empty zone as the host zone', () => {
            assertEqual(
                render('2017-04-22T10:30:00Z', { format: 'ISO' }),
                render('2017-04-22T10:30:00Z', { format: 'ISO', zone: '' }),
            );
        });
    });

    describe('host locale', ({ it }) => {

        it('uses the runtime default locale when none is given', () => {
            const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
            const expected = new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'America/New_York' })
                .format(new Date(INSTANT));

            assertEqual(expected, render(INSTANT, { format: 'DATE_HUGE', zone: 'America/New_York' }));
            assertEqual(expected, render(INSTANT, { format: 'DATE_HUGE', zone: 'America/New_York', locale: '' }));
        });
    });

    describe('never throws', ({ it }) => {

        it('returns a string for odd values', () => {
            const oddValues = [
                Symbol('odd'),
                function namedFunction() {},
                10n,
                Object.create(null),
                { get year() {
                    throw new TypeError('getter');
                } },
                [],
                new Map(),
                new Proxy({}, {
                    ownKeys() {
                        throw new Error('trap');
                    },
                    getPrototypeOf() {
                        throw new Error('trap');
                    },
                }),
            ];

            for (const value of oddValues) {
                assertEqual('string', typeof render(value, { format: 'DATE_MED' }));
            }
        });

        it('returns a string for odd options', () => {
            assertEqual('string', typeof render(INSTANT, { zone: {}, locale: [], format: null }));
            assert(render(INSTANT, null).length > 0);
        });
    });

    describe('empty values', ({ it }) => {

        it('renders an empty string for an empty string, null, or undefined', () => {
            assertEqual('', render(''));
            assertEqual('', render(null));
            assertEqual('', render(undefined));
        });

        it('renders an empty string even with an unknown format', () => {
            assertEqual('', render('', { format: 'NOPE' }));
            assertEqual('', render(null, { format: 'NOPE' }));
        });
    });
});
