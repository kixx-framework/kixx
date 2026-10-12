import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from 'kixx-assert';

import formatDate from '../../../../../src/kixx/hyperview/helpers/format-date.js';


// The helper signature is (context, options, ...positionals). The named options
// carry the format, zone, and locale, so every call here supplies them.
function render(date, options) {
    return formatDate(null, options ?? {}, date);
}

// A fixed instant, expressed in UTC so a test never depends on the host zone.
const INSTANT = '1983-10-14T13:30:23.000Z';


describe('formatDate helper', ({ it }) => {

    it('formats an ISO string', () => {
        assertEqual('1983-10-14', render(INSTANT, { format: 'ISO_DATE', zone: 'UTC' }));
    });

    it('formats a millisecond timestamp', () => {
        const millis = Date.parse(INSTANT);

        assertEqual('1983-10-14', render(millis, { format: 'ISO_DATE', zone: 'UTC' }));
    });

    it('formats a Date instance', () => {
        assertEqual('1983-10-14', render(new Date(INSTANT), { format: 'ISO_DATE', zone: 'UTC' }));
    });

    it('formats an object of date parts', () => {
        const parts = { year: 1983, month: 10, day: 14 };

        assertEqual('1983-10-14', render(parts, { format: 'ISO_DATE', zone: 'UTC' }));
    });

    it('renders the requested zone rather than the host zone', () => {
        // Just after midnight UTC, so the two zones fall on different dates.
        const justAfterMidnight = '1983-10-14T02:00:00.000Z';

        assertEqual('1983-10-14', render(justAfterMidnight, { format: 'ISO_DATE', zone: 'UTC' }));
        assertEqual('1983-10-13', render(justAfterMidnight, { format: 'ISO_DATE', zone: 'America/New_York' }));
    });

    it('formats a full ISO 8601 string', () => {
        assertMatches('1983-10-14T13:30:23.000', render(INSTANT, { format: 'ISO', zone: 'UTC' }));
    });

    it('formats an RFC 7231 UTC string', () => {
        assertEqual('Fri, 14 Oct 1983 13:30:23 GMT', render(INSTANT, { format: 'UTC', zone: 'UTC' }));
    });

    it('formats a short month and day', () => {
        assertEqual('Oct 14', render(INSTANT, { format: 'DATE_MONTH_DATE', zone: 'UTC', locale: 'en-US' }));
    });

    it('accepts a Luxon preset name as the format', () => {
        assertEqual('October 14, 1983', render(INSTANT, { format: 'DATE_FULL', zone: 'UTC', locale: 'en-US' }));
    });

    it('falls back to a short date and time for an unrecognized format', () => {
        assertMatches('10/14/1983', render(INSTANT, { format: 'NOPE', zone: 'UTC', locale: 'en-US' }));
    });

    it('returns an empty string for an empty string', () => {
        assertEqual('', render(''));
    });

    it('returns an empty string for null', () => {
        assertEqual('', render(null));
    });

    it('returns an empty string for undefined', () => {
        assertEqual('', render(undefined));
    });

    it('renders a diagnostic string for an unparseable date', () => {
        assertMatches('Invalid date', render('not-a-date', { format: 'ISO_DATE' }));
    });

    it('renders a diagnostic string for a value which is not a date at all', () => {
        assertMatches('Invalid date', render(true, { format: 'ISO_DATE' }));
    });
});
