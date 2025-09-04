import { describe } from 'kixx-test';
import { assertEqual, assert } from 'kixx-assert';
import format_date from '../../../lib/view-service/helpers/format_date.js';

describe('format_date(): with empty, null, or undefined date', ({ it }) => {
    it('returns empty string for empty string', () => {
        const result = format_date(null, {}, '');
        assertEqual('', result);
    });

    it('returns empty string for null', () => {
        const result = format_date(null, {}, null);
        assertEqual('', result);
    });

    it('returns empty string for undefined', () => {
        const result = format_date(null, {}, undefined);
        assertEqual('', result);
    });
});

describe('format_date(): with string date input', ({ it }) => {
    it('formats ISO string with default format', () => {
        const result = format_date(null, {}, '2017-06-14T07:00:00.000Z');
        assert(result.includes('6/14/2017'));
    });


    it('formats ISO string with zone option', () => {
        const result = format_date(null, { format: 'ISO', zone: 'America/New_York' }, '2017-06-14T07:00:00.000Z');
        assert(result.includes('2017-06-14'));
    });

    it('formats ISO string with locale option', () => {
        const result = format_date(null, { format: 'DATE_MONTH_DATE', locale: 'fr' }, '2017-06-14T07:00:00.000Z');
        assert(result.includes('14'));
    });

    it('returns invalid reason for invalid ISO string', () => {
        const result = format_date(null, {}, 'invalid-date-string');
        assertEqual('Invalid date (unparsable) String(invalid-date-string)', result);
    });
});

describe('format_date(): with number date input', ({ it }) => {
    it('formats millisecond timestamp with default format', () => {
        const timestamp = new Date('2017-06-14T07:00:00.000Z').getTime();
        const result = format_date(null, {}, timestamp);
        assert(result.includes('6/14/2017'));
    });


    it('formats millisecond timestamp with zone option', () => {
        const timestamp = new Date('2017-06-14T07:00:00.000Z').getTime();
        const result = format_date(null, { format: 'ISO', zone: 'America/New_York' }, timestamp);
        assert(result.includes('2017-06-14'));
    });

    it('formats millisecond timestamp with locale option', () => {
        const timestamp = new Date('2017-06-14T07:00:00.000Z').getTime();
        const result = format_date(null, { format: 'DATE_MONTH_DATE', locale: 'fr' }, timestamp);
        assert(result.includes('14'));
    });

    it('returns invalid reason for NaN', () => {
        const result = format_date(null, {}, NaN);
        assert(result.includes('Invalid'));
    });
});

describe('format_date(): with Date object input', ({ it }) => {
    it('formats Date object with default format', () => {
        const date = new Date('2017-06-14T07:00:00.000Z');
        const result = format_date(null, {}, date);
        assert(result.includes('6/14/2017'));
    });


    it('formats Date object with zone option', () => {
        const date = new Date('2017-06-14T07:00:00.000Z');
        const result = format_date(null, { format: 'ISO', zone: 'America/New_York' }, date);
        assert(result.includes('2017-06-14'));
    });

    it('formats Date object with locale option', () => {
        const date = new Date('2017-06-14T07:00:00.000Z');
        const result = format_date(null, { format: 'DATE_MONTH_DATE', locale: 'fr' }, date);
        assert(result.includes('14'));
    });

    it('returns invalid reason for invalid Date object', () => {
        const date = new Date('invalid-date');
        const result = format_date(null, {}, date);
        assertEqual('Invalid date (invalid input) Date(Invalid)', result);
    });
});

describe('format_date(): with object date input', ({ it }) => {
    it('formats date object with default format', () => {
        const dateObj = { year: 2017, month: 6, day: 14, hour: 7, minute: 0, second: 0 };
        const result = format_date(null, {}, dateObj);
        assert(result.includes('6/14/2017'));
    });


    it('formats date object with zone option', () => {
        const dateObj = { year: 2017, month: 6, day: 14, hour: 7, minute: 0, second: 0 };
        const result = format_date(null, { format: 'ISO', zone: 'America/New_York' }, dateObj);
        assert(result.includes('2017-06-14'));
    });

    it('formats date object with locale option', () => {
        const dateObj = { year: 2017, month: 6, day: 14, hour: 7, minute: 0, second: 0 };
        const result = format_date(null, { format: 'DATE_MONTH_DATE', locale: 'fr' }, dateObj);
        assert(result.includes('14'));
    });

    it('returns invalid reason for invalid date object', () => {
        const dateObj = { year: 2017, month: 13, day: 45 };
        const result = format_date(null, {}, dateObj);
        assert(result.includes('Invalid'));
    });
});

describe('format_date(): with invalid input types', ({ it }) => {
    it('returns invalid message for boolean true', () => {
        const result = format_date(null, {}, true);
        assertEqual('Invalid date Boolean(true)', result);
    });

    it('returns invalid message for boolean false', () => {
        const result = format_date(null, {}, false);
        assertEqual('Invalid date Boolean(false)', result);
    });

    it('returns invalid message for function', () => {
        const result = format_date(null, {}, () => {});
        assert(result.includes('Invalid date'));
    });

    it('returns invalid message for array', () => {
        const result = format_date(null, {}, [ 1, 2, 3 ]);
        assert(result.includes('Invalid date'));
    });
});

describe('format_date(): with custom formats', ({ it }) => {
    const testDate = new Date('2017-06-14T07:00:00.000Z');

    it('formats with ISO format', () => {
        const result = format_date(null, { format: 'ISO', zone: 'utc' }, testDate);
        assertEqual('2017-06-14T07:00:00.000Z', result);
    });

    it('formats with ISO_DATE format', () => {
        const result = format_date(null, { format: 'ISO_DATE', zone: 'utc' }, testDate);
        assertEqual('2017-06-14', result);
    });

    it('formats with UTC format', () => {
        const result = format_date(null, { format: 'UTC', zone: 'utc' }, testDate);
        assertEqual('Wed, 14 Jun 2017 07:00:00 GMT', result);
    });

    it('formats with DATE_MONTH_DATE format', () => {
        const result = format_date(null, { format: 'DATE_MONTH_DATE' }, testDate);
        assertEqual('Jun 14', result);
    });
});

describe('format_date(): with Luxon preset formats', ({ it }) => {
    const testDate = new Date('2017-06-14T07:00:00.000Z');

    it('formats with DATE_SHORT preset', () => {
        const result = format_date(null, { format: 'DATE_SHORT' }, testDate);
        assertEqual('6/14/2017', result);
    });

    it('formats with DATE_MED preset', () => {
        const result = format_date(null, { format: 'DATE_MED' }, testDate);
        assertEqual('Jun 14, 2017', result);
    });

    it('formats with DATE_FULL preset', () => {
        const result = format_date(null, { format: 'DATE_FULL' }, testDate);
        assertEqual('June 14, 2017', result);
    });

    it('formats with TIME_SIMPLE preset', () => {
        const result = format_date(null, { format: 'TIME_SIMPLE', zone: 'America/New_York' }, testDate);
        assertEqual('3:00 AM', result);
    });

    it('formats with TIME_24_SIMPLE preset', () => {
        const result = format_date(null, { format: 'TIME_24_SIMPLE', zone: 'America/New_York' }, testDate);
        assertEqual('03:00', result);
    });

    it('formats with DATETIME_MED preset', () => {
        const result = format_date(null, { format: 'DATETIME_MED', zone: 'America/New_York' }, testDate);
        assertEqual('Jun 14, 2017, 3:00 AM', result);
    });

    it('formats with DATETIME_FULL preset', () => {
        const result = format_date(null, { format: 'DATETIME_FULL', zone: 'America/New_York' }, testDate);
        assertEqual('June 14, 2017 at 3:00 AM EDT', result);
    });
});

describe('format_date(): with combined zone and locale options', ({ it }) => {
    const testDate = new Date('2017-06-14T07:00:00.000Z');

    it('formats with both zone and locale options', () => {
        const result = format_date(null, {
            format: 'DATETIME_MED',
            zone: 'America/New_York',
            locale: 'fr',
        }, testDate);
        assert(result.includes('2017'));
    });

    it('formats with zone option only', () => {
        const result = format_date(null, {
            format: 'ISO',
            zone: 'America/New_York',
        }, testDate);
        assert(result.includes('2017-06-14'));
    });

    it('formats with locale option only', () => {
        const result = format_date(null, {
            format: 'DATE_MONTH_DATE',
            locale: 'fr',
        }, testDate);
        assert(result.includes('14'));
    });
});
