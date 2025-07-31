import { luxon } from '../../vendor/mod.js';
import { isDate, isNumberNotNaN, toFriendlyString } from '../../assertions/mod.js';

const { DateTime } = luxon;

/*
# Luxon Formatting Presets

Based on the Luxon documentation, here are the formatting presets available for `toLocaleString()` method.
These presets use the example date of **October 14, 1983 at 13:30:23**.

## Complete Formatting Presets Table

|        Name                       | Example in en_US                                 |
|-----------------------------------|--------------------------------------------------|
| `DATE_SHORT`                      | 10/14/1983                                       |
| `DATE_MED`                        | Oct 14, 1983                                     |
| `DATE_MED_WITH_WEEKDAY`           | Fri, Oct 14, 1983                                |
| `DATE_FULL`                       | October 14, 1983                                 |
| `DATE_HUGE`                       | Friday, October 14, 1983                         |
| `TIME_SIMPLE`                     | 1:30 PM                                          |
| `TIME_WITH_SECONDS`               | 1:30:23 PM                                       |
| `TIME_WITH_SHORT_OFFSET`          | 1:30:23 PM EDT                                   |
| `TIME_WITH_LONG_OFFSET`           | 1:30:23 PM Eastern Daylight Time                 |
| `TIME_24_SIMPLE`                  | 13:30                                            |
| `TIME_24_WITH_SECONDS`            | 13:30:23                                         |
| `TIME_24_WITH_SHORT_OFFSET`       | 13:30:23 EDT                                     |
| `TIME_24_WITH_LONG_OFFSET`        | 13:30:23 Eastern Daylight Time                   |
| `DATETIME_SHORT`                  | 10/14/1983, 1:30 PM                              |
| `DATETIME_MED`                    | Oct 14, 1983, 1:30 PM                            |
| `DATETIME_MED_WITH_WEEKDAY`       | Fri, Oct 14, 1983, 1:30 PM                       |
| `DATETIME_FULL`                   | October 14, 1983 at 1:30 PM EDT                  |
| `DATETIME_HUGE`                   | Friday, October 14, 1983 at 1:30 PM Eastern Daylight Time |
| `DATETIME_SHORT_WITH_SECONDS`     | 10/14/1983, 1:30:23 PM                           |
| `DATETIME_MED_WITH_SECONDS`       | Oct 14, 1983, 1:30:23 PM                         |
| `DATETIME_FULL_WITH_SECONDS`      | October 14, 1983 at 1:30:23 PM EDT               |
| `DATETIME_HUGE_WITH_SECONDS`      | Friday, October 14, 1983 at 1:30:23 PM Eastern Daylight Time |

*/


export default function format_date(context, options, date) {
    if (date === '' || date === null || typeof date === 'undefined') {
        return '';
    }

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

    if (format === 'ISO_DATE') {
        return dt.toISODate();
    }

    if (format === 'DATE_MONTH_DATE') {
        return dt.toLocaleString({ month: 'short', day: 'numeric' });
    }

    if (DateTime[format]) {
        return dt.toLocaleString(DateTime[format]);
    }

    return dt.toLocaleString(DateTime.DATETIME_SHORT);
}
