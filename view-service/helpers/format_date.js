import { luxon } from '../../vendor/mod.js';

const { DateTime } = luxon;

export default function format_date(context, options, isoDateString) {
    if (!isoDateString) {
        return '';
    }

    const { format, zone, locale } = options;

    let d;
    if (zone && locale) {
        d = DateTime.fromISO(isoDateString, { zone, locale });
    } else if (locale) {
        d = DateTime.fromISO(isoDateString, { locale });
    } else if (zone) {
        d = DateTime.fromISO(isoDateString, { zone });
    } else {
        d = DateTime.fromISO(isoDateString);
    }

    if (d.invalidReason) {
        return d.invalidReason;
    }

    if (format === 'DATE_MONTH_DATE') {
        return d.toLocaleString({ month: 'short', day: 'numeric' });
    }

    if (DateTime[format]) {
        return d.toLocaleString(DateTime[format]);
    }

    return d.toLocaleString(DateTime.DATETIME_SHORT);
}
