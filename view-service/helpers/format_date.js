import { luxon } from '../../vendor/mod.js';
import { isDate, isNumberNotNaN, toFriendlyString } from '../../assertions/mod.js';

const { DateTime } = luxon;


export default function format_date(context, options, date) {
    const { format, zone, locale } = options;

    let dateTimeOptions;
    if (zone || locale) {
        dateTimeOptions = { zone, locale };
    }

    let dt;
    if (isDate(date)) {
        dt = dateTimeOptions ? DateTime.fromJSDate(date, dateTimeOptions) : DateTime.fromJSDate(date);
    } else if (isNumberNotNaN(date)) {
        dt = dateTimeOptions ? DateTime.fromMillis(date, dateTimeOptions) : DateTime.fromMillis(date);
    } else if (date && typeof date === 'object') {
        dt = dateTimeOptions ? DateTime.fromObject(date, dateTimeOptions) : DateTime.fromObject(date);
    } else if (typeof date === 'string') {
        dt = dateTimeOptions ? DateTime.fromISO(date, dateTimeOptions) : DateTime.fromISO(date);
    } else {
        return `Invalid date ${ toFriendlyString(date) }`;
    }

    if (dt.invalidReason) {
        return dt.invalidReason;
    }

    if (format === 'ISO') {
        return dt.toISO();
    }

    if (format === 'DATE_MONTH_DATE') {
        return dt.toLocaleString({ month: 'short', day: 'numeric' });
    }

    if (DateTime[format]) {
        return dt.toLocaleString(DateTime[format]);
    }

    return dt.toLocaleString(DateTime.DATETIME_SHORT);
}
