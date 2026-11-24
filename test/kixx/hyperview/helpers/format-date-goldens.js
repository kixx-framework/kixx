import { assertEqual } from '../../../../kixx/assertions/mod.js';


// October 14, 1983 at 13:30:23 in America/New_York.
export const INSTANT = '1983-10-14T13:30:23.000-04:00';

export const NEW_YORK_EN_US = { zone: 'America/New_York', locale: 'en-US' };

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

/**
 * @callback MakeFormatDateSubject
 * @returns {{ formatDate: Function }} The `formatDate` helper under test.
 */

/**
 * The formatDate strings that depend on the runtime's locale and time zone
 * data, as one suite.
 *
 * The helper formats with `Intl.DateTimeFormat`, so these strings come from
 * the data the runtime ships with. The unit suite checks them on the runtime
 * running the tests. The same cases also run on real platforms, against the
 * copy of the helper deployed there, which is why the helper arrives through
 * a factory instead of an import.
 *
 * Before you change it, read the rules for suites that run on a real platform
 * in `test/README.md`, under "Shared Conformance Suites".
 *
 * @param {Function} describe - Nested `describe` handle from the enclosing block.
 * @param {MakeFormatDateSubject} makeSubject - Returns the helper under test. Called once per test.
 */
export default function formatDateGoldens(describe, makeSubject) {

    describe('every format in en-US and America/New_York', ({ it }) => {

        it('covers all 27 formats', () => {
            assertEqual(27, GOLDEN_STRINGS.length);
        });

        for (const [ format, expected ] of GOLDEN_STRINGS) {
            it(`formats ${ format }`, () => {
                const { formatDate } = makeSubject();

                assertEqual(expected, render(formatDate, INSTANT, { ...NEW_YORK_EN_US, format }));
            });
        }

        it('accepts a v6 preset name as the format', () => {
            const { formatDate } = makeSubject();

            assertEqual('October 14, 1983', render(formatDate, INSTANT, { ...NEW_YORK_EN_US, format: 'DATE_FULL' }));
        });
    });

    describe('fixed UTC zone', ({ it }) => {

        it('ends ISO with Z for UTC, utc, and GMT', () => {
            const { formatDate } = makeSubject();

            assertEqual('1983-10-14T17:30:23.000Z', renderISO(formatDate, INSTANT, 'UTC'));
            assertEqual('1983-10-14T17:30:23.000Z', renderISO(formatDate, INSTANT, 'utc'));
            assertEqual('1983-10-14T17:30:23.000Z', renderISO(formatDate, INSTANT, 'GMT'));
        });

        it('names the zone UTC in short and long zone names', () => {
            const { formatDate } = makeSubject();
            const options = { zone: 'UTC', locale: 'en-US' };

            assertEqual('5:30:23 PM UTC', render(formatDate, INSTANT, { ...options, format: 'TIME_WITH_SHORT_OFFSET' }));
            assertEqual('5:30:23 PM UTC', render(formatDate, INSTANT, { ...options, format: 'TIME_WITH_LONG_OFFSET' }));
            assertEqual(
                'Friday, October 14, 1983 at 5:30 PM UTC',
                render(formatDate, INSTANT, { ...options, format: 'DATETIME_HUGE' }),
            );
        });

        it('treats Etc/UTC as an ordinary zone', () => {
            const { formatDate } = makeSubject();

            assertEqual('1983-10-14T17:30:23.000+00:00', renderISO(formatDate, INSTANT, 'Etc/UTC'));
            assertEqual('5:30:23 PM Coordinated Universal Time', render(formatDate, INSTANT, {
                zone: 'Etc/UTC',
                locale: 'en-US',
                format: 'TIME_WITH_LONG_OFFSET',
            }));
        });
    });
}

// The helper signature is (context, options, ...positionals). The named options
// carry the format, zone, and locale.
function render(formatDate, date, options) {
    return formatDate(null, options ?? {}, date);
}

function renderISO(formatDate, date, zone) {
    return render(formatDate, date, { format: 'ISO', zone });
}
