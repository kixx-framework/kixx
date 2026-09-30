import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import { parseCron, nextOccurrence } from '../../../../src/kixx/jobs/cron.js';


describe('cron', ({ describe }) => {

    describe('parseCron()', ({ it }) => {
        it('expands * across each field range', () => {
            const parsed = parseCron('* * * * *');

            assertEqual(60, parsed.minutes.length);
            assertEqual(24, parsed.hours.length);
            assertEqual(31, parsed.daysOfMonth.length);
            assertEqual(12, parsed.months.length);
            assertEqual('0,1,2,3,4,5,6', parsed.daysOfWeek.join(','));
        });

        it('parses lists, ranges, and steps', () => {
            const parsed = parseCron('0,30 9-17/4 */10 1-6/2 1-5');

            assertEqual('0,30', parsed.minutes.join(','));
            assertEqual('9,13,17', parsed.hours.join(','));
            assertEqual('1,11,21,31', parsed.daysOfMonth.join(','));
            assertEqual('1,3,5', parsed.months.join(','));
            assertEqual('1,2,3,4,5', parsed.daysOfWeek.join(','));
        });

        it('sorts and de-duplicates list values', () => {
            assertEqual('5,10,15', parseCron('15,5,10,5 * * * *').minutes.join(','));
        });

        it('treats day-of-week 7 as Sunday', () => {
            assertEqual('0', parseCron('0 0 * * 7').daysOfWeek.join(','));
            assertEqual('0,5,6', parseCron('0 0 * * 5-7').daysOfWeek.join(','));
        });

        it('accepts surrounding and repeated whitespace', () => {
            assertEqual('5', parseCron('  5   *  *\t* *  ').minutes.join(','));
        });

        it('records whether each day field is restricted', () => {
            const both = parseCron('0 0 1 * 1');
            const stepped = parseCron('0 0 */2 * *');

            assert(both.isDayOfMonthRestricted);
            assert(both.isDayOfWeekRestricted);
            assert(!stepped.isDayOfMonthRestricted);
            assert(!stepped.isDayOfWeekRestricted);
        });

        it('returns a frozen result', () => {
            const parsed = parseCron('0 0 * * *');

            assert(Object.isFrozen(parsed));
            assert(Object.isFrozen(parsed.minutes));
        });

        it('rejects unsupported and malformed forms with a field-specific message', () => {
            const cases = [
                [ '', 'non-empty' ],
                [ '* * * *', '5 fields' ],
                [ '* * * * * *', '5 fields' ],
                [ '@daily', '5 fields' ],
                [ '60 * * * *', 'minute' ],
                [ '* 24 * * *', 'hour' ],
                [ '* * 0 * *', 'day-of-month' ],
                [ '* * 32 * *', 'day-of-month' ],
                [ '* * * 13 *', 'month' ],
                [ '* * * * 8', 'day-of-week' ],
                [ '* * * JAN *', 'month' ],
                [ '* * * * MON', 'day-of-week' ],
                [ '* * L * *', 'day-of-month' ],
                [ '* * * * 1#2', 'day-of-week' ],
                [ '5-1 * * * *', 'minute' ],
                [ '*/0 * * * *', 'minute' ],
                [ '*/x * * * *', 'minute' ],
                [ '5/15 * * * *', 'minute' ],
                [ '1-2-3 * * * *', 'minute' ],
                [ '1,,2 * * * *', 'minute' ],
                [ '*/5/2 * * * *', 'minute' ],
                [ '-1 * * * *', 'minute' ],
            ];

            for (const [ expression, fragment ] of cases) {
                const error = catchError(() => parseCron(expression));

                assert(error, `expected "${ expression }" to be rejected`);
                assertEqual('ValidationError', error.name);
                assert(error.message.includes(fragment), `"${ expression }": expected "${ fragment }" in "${ error.message }"`);
            }
        });

        it('rejects non-string input', () => {
            assertEqual('ValidationError', catchError(() => parseCron(null)).name);
            assertEqual('ValidationError', catchError(() => parseCron(5)).name);
        });
    });

    describe('nextOccurrence()', ({ it }) => {
        it('is strictly after the given instant', () => {
            const parsed = parseCron('*/15 * * * *');

            assertIso('2026-03-10T12:15:00.000Z', nextOccurrence(parsed, at('2026-03-10T12:00:00.000Z')));
            assertIso('2026-03-10T12:15:00.000Z', nextOccurrence(parsed, at('2026-03-10T12:14:59.999Z')));
            assertIso('2026-03-10T12:30:00.000Z', nextOccurrence(parsed, at('2026-03-10T12:15:00.000Z')));
        });

        it('truncates to the minute', () => {
            const next = nextOccurrence(parseCron('* * * * *'), at('2026-03-10T12:00:30.500Z'));

            assertIso('2026-03-10T12:01:00.000Z', next);
        });

        it('rolls over to the next hour and day', () => {
            const parsed = parseCron('30 2 * * *');

            assertIso('2026-03-10T02:30:00.000Z', nextOccurrence(parsed, at('2026-03-10T01:00:00.000Z')));
            assertIso('2026-03-11T02:30:00.000Z', nextOccurrence(parsed, at('2026-03-10T02:30:00.000Z')));
            assertIso('2026-03-11T02:30:00.000Z', nextOccurrence(parsed, at('2026-03-10T23:59:00.000Z')));
        });

        it('finds a later minute within the same hour on the start day', () => {
            const parsed = parseCron('10,50 5 * * *');

            assertIso('2026-03-10T05:50:00.000Z', nextOccurrence(parsed, at('2026-03-10T05:10:00.000Z')));
            assertIso('2026-03-11T05:10:00.000Z', nextOccurrence(parsed, at('2026-03-10T05:50:00.000Z')));
        });

        it('rolls over month and year boundaries', () => {
            assertIso('2026-02-01T00:00:00.000Z', nextOccurrence(parseCron('0 0 1 * *'), at('2026-01-31T12:00:00.000Z')));
            assertIso('2027-01-01T00:00:00.000Z', nextOccurrence(parseCron('0 0 1 1 *'), at('2026-06-15T00:00:00.000Z')));
            assertIso('2027-01-01T00:00:00.000Z', nextOccurrence(parseCron('0 0 * * *'), at('2026-12-31T23:59:00.000Z')));
        });

        it('skips months that lack the requested day', () => {
            assertIso('2026-03-31T00:00:00.000Z', nextOccurrence(parseCron('0 0 31 * *'), at('2026-01-31T00:00:00.000Z')));
        });

        it('handles leap days', () => {
            const parsed = parseCron('0 0 29 2 *');

            assertIso('2028-02-29T00:00:00.000Z', nextOccurrence(parsed, at('2026-03-01T00:00:00.000Z')));
            assertIso('2032-02-29T00:00:00.000Z', nextOccurrence(parsed, at('2028-02-29T00:00:00.000Z')));
            // 2100 is not a leap year, so the gap after 2096 is eight years.
            assertIso('2104-02-29T00:00:00.000Z', nextOccurrence(parsed, at('2096-02-29T00:00:00.000Z')));
        });

        it('matches day-of-week alone', () => {
            // 2026-03-10 is a Tuesday; the next Monday is the 16th.
            assertIso('2026-03-16T09:00:00.000Z', nextOccurrence(parseCron('0 9 * * 1'), at('2026-03-10T10:00:00.000Z')));
            assertIso('2026-03-15T09:00:00.000Z', nextOccurrence(parseCron('0 9 * * 7'), at('2026-03-10T10:00:00.000Z')));
        });

        it('matches either day field when both are restricted', () => {
            // 1st of the month OR Monday.
            const parsed = parseCron('0 0 1 * 1');

            // 2026-03-10 is a Tuesday: the next Monday (16th) beats April 1st.
            assertIso('2026-03-16T00:00:00.000Z', nextOccurrence(parsed, at('2026-03-10T00:00:00.000Z')));
            // 2026-03-30 is a Monday: the 1st of April (a Wednesday) is next.
            assertIso('2026-04-01T00:00:00.000Z', nextOccurrence(parsed, at('2026-03-30T00:00:00.000Z')));
        });

        it('requires the day-of-month when day-of-week is a bare star', () => {
            assertIso('2026-03-15T00:00:00.000Z', nextOccurrence(parseCron('0 0 15 * *'), at('2026-03-10T00:00:00.000Z')));
        });

        it('throws instead of looping for an impossible expression', () => {
            const parsed = parseCron('0 0 31 2 *');
            const error = catchError(() => nextOccurrence(parsed, at('2026-01-01T00:00:00.000Z')));

            assert(error, 'expected an error');
            assertEqual('ValidationError', error.name);
        });

        it('rejects an invalid date', () => {
            const error = catchError(() => nextOccurrence(parseCron('* * * * *'), new Date('nope')));

            assert(error, 'expected an error');
        });
    });
});

function at(iso) {
    return new Date(iso);
}

function assertIso(expected, date) {
    assertEqual(expected, date.toISOString());
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
