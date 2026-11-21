import { ValidationError } from '../errors/mod.js';
import { assertValidDate, isNonEmptyString } from '../assertions/mod.js';


// Days of search before giving up on an expression that never matches, such as
// "0 0 31 2 *". Eight years spans the longest gap between Feb 29th occurrences
// (2096 to 2104, because 2100 is not a leap year).
const MAX_SEARCH_DAYS = 8 * 366;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

// Day-of-week accepts 7 as an alias for Sunday (0). A bare "*" covers 0-6 so
// Sunday is not listed twice.
const FIELDS = [
    { key: 'minutes', label: 'minute', min: 0, max: 59 },
    { key: 'hours', label: 'hour', min: 0, max: 23 },
    { key: 'daysOfMonth', label: 'day-of-month', min: 1, max: 31 },
    { key: 'months', label: 'month', min: 1, max: 12 },
    { key: 'daysOfWeek', label: 'day-of-week', min: 0, max: 7, starMax: 6 },
];

const INTEGER_PATTERN = /^\d+$/;


/**
 * @typedef {Object} ParsedCron
 * @property {string} expression - The original expression.
 * @property {number[]} minutes - Sorted matching minutes, 0-59.
 * @property {number[]} hours - Sorted matching hours, 0-23.
 * @property {number[]} daysOfMonth - Sorted matching days of the month, 1-31.
 * @property {number[]} months - Sorted matching months, 1-12.
 * @property {number[]} daysOfWeek - Sorted matching days of the week, 0-6 with Sunday as 0.
 * @property {boolean} isDayOfMonthRestricted - False when the day-of-month field begins with `*`.
 * @property {boolean} isDayOfWeekRestricted - False when the day-of-week field begins with `*`.
 */

/**
 * Parses a 5-field cron expression: minute, hour, day-of-month, month, day-of-week.
 *
 * Each field supports `*`, lists (`a,b`), ranges (`a-b`), and steps (`a-b/n`, or a
 * step over `*`). Names, `@` macros, `L`, `W`, `#`, and seconds are not supported.
 * Day-of-week accepts 0-7, where both 0 and 7 mean Sunday.
 * @param {string} expression - Whitespace separated cron expression.
 * @returns {ParsedCron} Frozen parsed form.
 * @throws {ValidationError} When the expression is malformed; the message names the bad field.
 */
export function parseCron(expression) {
    if (!isNonEmptyString(expression)) {
        throw new ValidationError('A cron expression must be a non-empty string');
    }

    const parts = expression.trim().split(/\s+/);

    if (parts.length !== FIELDS.length) {
        throw new ValidationError(
            `A cron expression must have 5 fields (minute hour day-of-month month day-of-week); got ${ parts.length }`,
        );
    }

    const parsed = { expression };

    FIELDS.forEach((field, index) => {
        parsed[field.key] = Object.freeze(parseField(parts[index], field));
    });

    parsed.isDayOfMonthRestricted = !parts[2].startsWith('*');
    parsed.isDayOfWeekRestricted = !parts[4].startsWith('*');

    return Object.freeze(parsed);
}

/**
 * Computes the first matching minute strictly after a given instant, in UTC.
 * @param {ParsedCron} parsed - Result of `parseCron()`.
 * @param {Date} afterDate - The instant to search after; sub-minute precision is ignored.
 * @returns {Date} A UTC minute boundary later than `afterDate`.
 * @throws {ValidationError} When the expression has no occurrence within eight years, such as `0 0 31 2 *`.
 */
export function nextOccurrence(parsed, afterDate) {
    assertValidDate(afterDate, 'nextOccurrence() afterDate');

    // The earliest candidate is the minute after the one containing afterDate.
    const startMs = (Math.floor(afterDate.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE) + MS_PER_MINUTE;
    const start = new Date(startMs);
    const startDayMs = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());

    for (let i = 0; i < MAX_SEARCH_DAYS; i += 1) {
        const day = new Date(startDayMs + (i * MS_PER_DAY));

        if (!isDayMatch(parsed, day)) {
            continue;
        }

        // Only the first day is constrained by the start time of day.
        const isFirstDay = i === 0;
        const startHour = start.getUTCHours();
        const startMinute = start.getUTCMinutes();

        for (const hour of parsed.hours) {
            if (isFirstDay && hour < startHour) {
                continue;
            }

            const minMinute = isFirstDay && hour === startHour ? startMinute : 0;
            const minute = parsed.minutes.find((m) => m >= minMinute);

            if (minute !== undefined) {
                return new Date(day.getTime() + (((hour * 60) + minute) * MS_PER_MINUTE));
            }
        }
    }

    throw new ValidationError(`The cron expression "${ parsed.expression }" has no occurrence within 8 years`);
}

function isDayMatch(parsed, day) {
    if (!parsed.months.includes(day.getUTCMonth() + 1)) {
        return false;
    }

    const isDayOfMonthMatch = parsed.daysOfMonth.includes(day.getUTCDate());
    const isDayOfWeekMatch = parsed.daysOfWeek.includes(day.getUTCDay());

    // Standard cron: when both day fields are restricted, either one matching
    // is enough. Otherwise the unrestricted field matches every day, so
    // requiring both is equivalent to requiring the restricted one.
    if (parsed.isDayOfMonthRestricted && parsed.isDayOfWeekRestricted) {
        return isDayOfMonthMatch || isDayOfWeekMatch;
    }

    return isDayOfMonthMatch && isDayOfWeekMatch;
}

function parseField(text, field) {
    const values = new Set();

    for (const item of text.split(',')) {
        for (const value of parseItem(item, field, text)) {
            // Fold Sunday's alias 7 into 0.
            values.add(field.key === 'daysOfWeek' && value === 7 ? 0 : value);
        }
    }

    return Array.from(values).sort((a, b) => a - b);
}

function parseItem(item, field, fieldText) {
    const fail = (reason) => new ValidationError(
        `Invalid cron ${ field.label } field "${ fieldText }": ${ reason }`,
    );

    const stepParts = item.split('/');

    if (stepParts.length > 2) {
        throw fail('only one step is allowed per item');
    }

    const [ rangeText, stepText ] = stepParts;

    let step = 1;

    if (stepText !== undefined) {
        if (!INTEGER_PATTERN.test(stepText) || Number(stepText) < 1) {
            throw fail('a step must be a positive integer');
        }
        step = Number(stepText);
    }

    let low;
    let high;

    if (rangeText === '*') {
        low = field.min;
        high = field.starMax ?? field.max;
    } else {
        const bounds = rangeText.split('-');

        if (bounds.length > 2 || !bounds.every((b) => INTEGER_PATTERN.test(b))) {
            throw fail(`"${ item }" is not a number, range, or "*"`);
        }

        low = Number(bounds[0]);
        high = bounds.length === 2 ? Number(bounds[1]) : low;

        // A step only makes sense over a range or "*"; "5/15" is ambiguous
        // across cron implementations, so it is rejected.
        if (stepText !== undefined && bounds.length === 1) {
            throw fail(`a step requires "*" or a range, got "${ item }"`);
        }

        if (low < field.min || high > field.max) {
            throw fail(`values must be between ${ field.min } and ${ field.max }`);
        }

        if (low > high) {
            throw fail(`range "${ item }" is descending`);
        }
    }

    const values = [];

    for (let value = low; value <= high; value += step) {
        values.push(value);
    }

    return values;
}
