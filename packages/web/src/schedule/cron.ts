// Cron parsing and zoned next-instant calculation for @zmdb/web/schedule.
//
// Expressions are parsed once into numeric sets. Runtime state is always an
// epoch-millisecond instant; local calendar fields exist only while calculating
// the next one. Resolving a wall time uses Temporal's "compatible" rule: gaps
// move forward and overlaps choose the earlier instant.

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MAX_SEARCH_DAYS = 366 * 8;

const MONTH_NAMES = new Map<string, number>([
  ['JAN', 1],
  ['FEB', 2],
  ['MAR', 3],
  ['APR', 4],
  ['MAY', 5],
  ['JUN', 6],
  ['JUL', 7],
  ['AUG', 8],
  ['SEP', 9],
  ['OCT', 10],
  ['NOV', 11],
  ['DEC', 12],
]);

const WEEKDAY_NAMES = new Map<string, number>([
  ['SUN', 0],
  ['MON', 1],
  ['TUE', 2],
  ['WED', 3],
  ['THU', 4],
  ['FRI', 5],
  ['SAT', 6],
]);

const NICKNAMES = new Map<string, string>([
  ['@yearly', '0 0 1 1 *'],
  ['@annually', '0 0 1 1 *'],
  ['@monthly', '0 0 1 * *'],
  ['@weekly', '0 0 * * 0'],
  ['@daily', '0 0 * * *'],
  ['@midnight', '0 0 * * *'],
  ['@hourly', '0 * * * *'],
]);

type FieldKind = 'second' | 'minute' | 'hour' | 'day-of-month' | 'month' | 'day-of-week';

interface FieldSpec {
  readonly kind: FieldKind;
  readonly minimum: number;
  readonly maximum: number;
  readonly names?: ReadonlyMap<string, number>;
}

interface ParsedField {
  readonly values: readonly number[];
  readonly matches: ReadonlySet<number>;
  readonly wildcard: boolean;
}

interface ParsedExpression {
  readonly seconds: ParsedField;
  readonly minutes: ParsedField;
  readonly hours: ParsedField;
  readonly daysOfMonth: ParsedField;
  readonly months: ParsedField;
  readonly daysOfWeek: ParsedField;
}

interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface GapRange {
  readonly startSecond: number;
  readonly endSecond: number;
}

/** A parsed cron expression bound to one explicit time zone. */
export interface CronPlan {
  nextAtOrAfter(instant: number): number;
  nextAfter(instant: number): number;
}

const SECOND: FieldSpec = { kind: 'second', minimum: 0, maximum: 59 };
const MINUTE: FieldSpec = { kind: 'minute', minimum: 0, maximum: 59 };
const HOUR: FieldSpec = { kind: 'hour', minimum: 0, maximum: 23 };
const DAY_OF_MONTH: FieldSpec = { kind: 'day-of-month', minimum: 1, maximum: 31 };
const MONTH: FieldSpec = { kind: 'month', minimum: 1, maximum: 12, names: MONTH_NAMES };
const DAY_OF_WEEK: FieldSpec = { kind: 'day-of-week', minimum: 0, maximum: 7, names: WEEKDAY_NAMES };

/** Parse once and return the two next-instant operations the scheduler needs. */
export function createCronPlan(expression: string, timeZone: string, taskName: string): CronPlan {
  const parsed = parseExpression(expression, taskName);
  const formatter = createFormatter(timeZone, taskName);

  const nextAfter = (instant: number): number => {
    const local = localParts(formatter, instant);
    const firstDay = Date.UTC(local.year, local.month - 1, local.day);

    for (let offset = 0; offset < MAX_SEARCH_DAYS; offset += 1) {
      const candidateDateValue = new Date(firstDay + offset * DAY_MS);
      const date: LocalDate = {
        year: candidateDateValue.getUTCFullYear(),
        month: candidateDateValue.getUTCMonth() + 1,
        day: candidateDateValue.getUTCDate(),
      };
      if (!dateMatches(parsed, date)) {
        continue;
      }

      const threshold = offset === 0 ? local.hour * 3600 + local.minute * 60 + local.second : -1;
      const candidate = candidateOnDate(parsed, formatter, date, threshold, instant);
      if (candidate !== undefined) {
        return candidate;
      }
    }

    throw new RangeError(
      `@zmdb/web: schedule "${taskName}" has no cron instant within ${String(MAX_SEARCH_DAYS)} days`,
    );
  };

  return {
    nextAtOrAfter: instant => nextAfter(instant - 1),
    nextAfter,
  };
}

function parseExpression(expression: string, taskName: string): ParsedExpression {
  const source = expression.trim();
  if (source === '@reboot') {
    throw cronError(taskName, 'expression', expression, '@reboot is not an instant');
  }
  const expanded = source.startsWith('@') ? NICKNAMES.get(source.toLowerCase()) : source;
  if (expanded === undefined) {
    throw cronError(taskName, 'expression', expression, 'unknown cron nickname');
  }

  const fields = expanded.split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    throw cronError(taskName, 'expression', expression, 'expected five fields or six with leading seconds');
  }
  const values = fields.length === 5 ? ['0', ...fields] : fields;
  const second = values[0];
  const minute = values[1];
  const hour = values[2];
  const dayOfMonth = values[3];
  const month = values[4];
  const dayOfWeek = values[5];
  if (
    second === undefined ||
    minute === undefined ||
    hour === undefined ||
    dayOfMonth === undefined ||
    month === undefined ||
    dayOfWeek === undefined
  ) {
    throw cronError(taskName, 'expression', expression, 'incomplete cron expression');
  }

  return {
    seconds: parseField(second, SECOND, taskName),
    minutes: parseField(minute, MINUTE, taskName),
    hours: parseField(hour, HOUR, taskName),
    daysOfMonth: parseField(dayOfMonth, DAY_OF_MONTH, taskName),
    months: parseField(month, MONTH, taskName),
    daysOfWeek: parseField(dayOfWeek, DAY_OF_WEEK, taskName),
  };
}

function parseField(source: string, spec: FieldSpec, taskName: string): ParsedField {
  if (/[LW#?]/i.test(source)) {
    throw cronError(taskName, spec.kind, source, 'Quartz extensions are not supported');
  }
  const values = new Set<number>();
  for (const segment of source.split(',')) {
    if (segment.length === 0) {
      throw cronError(taskName, spec.kind, source, 'empty list item');
    }
    const stepParts = segment.split('/');
    if (stepParts.length > 2) {
      throw cronError(taskName, spec.kind, source, 'too many step separators');
    }
    const base = stepParts[0];
    const stepSource = stepParts[1];
    if (base === undefined || base.length === 0) {
      throw cronError(taskName, spec.kind, source, 'missing range before step');
    }
    const step = stepSource === undefined ? 1 : parseInteger(stepSource, spec, taskName, source);
    if (step <= 0) {
      throw cronError(taskName, spec.kind, source, 'step must be a positive integer');
    }

    let first: number;
    let last: number;
    if (base === '*') {
      first = spec.minimum;
      last = spec.maximum;
    } else {
      const range = base.split('-');
      if (range.length > 2) {
        throw cronError(taskName, spec.kind, source, 'too many range separators');
      }
      const start = range[0];
      const end = range[1];
      if (start === undefined || start.length === 0) {
        throw cronError(taskName, spec.kind, source, 'missing range start');
      }
      first = parseValue(start, spec, taskName, source);
      last = end === undefined ? first : parseValue(end, spec, taskName, source);
      if (stepSource !== undefined && end === undefined) {
        throw cronError(taskName, spec.kind, source, 'a stepped value must use * or a range');
      }
      if (last < first) {
        throw cronError(taskName, spec.kind, source, 'range end precedes its start');
      }
    }

    for (let value = first; value <= last; value += step) {
      values.add(spec.kind === 'day-of-week' && value === 7 ? 0 : value);
    }
  }

  const ordered = [...values].toSorted((left, right) => left - right);
  if (ordered.length === 0) {
    throw cronError(taskName, spec.kind, source, 'field selects no values');
  }
  return { values: ordered, matches: new Set(ordered), wildcard: source === '*' };
}

function parseValue(source: string, spec: FieldSpec, taskName: string, field: string): number {
  const named = spec.names?.get(source.toUpperCase());
  const value = named ?? parseInteger(source, spec, taskName, field);
  if (value < spec.minimum || value > spec.maximum) {
    throw cronError(
      taskName,
      spec.kind,
      field,
      `value ${String(value)} is outside ${String(spec.minimum)}-${String(spec.maximum)}`,
    );
  }
  return value;
}

function parseInteger(source: string, spec: FieldSpec, taskName: string, field: string): number {
  if (!/^\d+$/.test(source)) {
    throw cronError(taskName, spec.kind, field, `"${source}" is not a number or known name`);
  }
  return Number.parseInt(source, 10);
}

function cronError(taskName: string, field: string, source: string, detail: string): RangeError {
  return new RangeError(`@zmdb/web: schedule "${taskName}" has invalid ${field} "${source}": ${detail}`);
}

function createFormatter(timeZone: string, taskName: string): Intl.DateTimeFormat {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatter.formatToParts(new Date(0));
    return formatter;
  } catch {
    throw new RangeError(`@zmdb/web: schedule "${taskName}" has unknown time zone "${timeZone}"`);
  }
}

function localParts(formatter: Intl.DateTimeFormat, instant: number): LocalParts {
  let year = Number.NaN;
  let month = Number.NaN;
  let day = Number.NaN;
  let hour = Number.NaN;
  let minute = Number.NaN;
  let second = Number.NaN;
  for (const part of formatter.formatToParts(new Date(instant))) {
    const value = Number.parseInt(part.value, 10);
    if (part.type === 'year') year = value;
    else if (part.type === 'month') month = value;
    else if (part.type === 'day') day = value;
    else if (part.type === 'hour') hour = value;
    else if (part.type === 'minute') minute = value;
    else if (part.type === 'second') second = value;
  }
  if ([year, month, day, hour, minute, second].some(value => !Number.isFinite(value))) {
    throw new Error('@zmdb/web: Intl.DateTimeFormat omitted a required calendar field');
  }
  return { year, month, day, hour, minute, second };
}

function dateMatches(expression: ParsedExpression, date: LocalDate): boolean {
  if (!expression.months.matches.has(date.month)) {
    return false;
  }
  const dayOfMonth = expression.daysOfMonth.matches.has(date.day);
  const dayOfWeek = expression.daysOfWeek.matches.has(
    new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay(),
  );
  if (expression.daysOfMonth.wildcard && expression.daysOfWeek.wildcard) {
    return true;
  }
  if (expression.daysOfMonth.wildcard) {
    return dayOfWeek;
  }
  if (expression.daysOfWeek.wildcard) {
    return dayOfMonth;
  }
  return dayOfMonth || dayOfWeek;
}

function candidateOnDate(
  expression: ParsedExpression,
  formatter: Intl.DateTimeFormat,
  date: LocalDate,
  threshold: number,
  after: number,
): number | undefined {
  let best: number | undefined;
  let cursor = threshold;
  for (let attempts = 0; attempts < 86_400; attempts += 1) {
    const secondOfDay = firstAllowedTimeAfter(expression, cursor);
    if (secondOfDay === undefined) {
      break;
    }
    const candidate = resolveWallTime(formatter, date, secondOfDay);
    if (candidate > after) {
      best = candidate;
      break;
    }
    cursor = secondOfDay;
  }

  for (const range of gapRanges(formatter, date)) {
    let gapCursor = range.startSecond - 1;
    for (let attempts = 0; attempts < 86_400; attempts += 1) {
      const secondOfDay = firstAllowedTimeAfter(expression, gapCursor);
      if (secondOfDay === undefined || secondOfDay >= range.endSecond) {
        break;
      }
      const candidate = resolveWallTime(formatter, date, secondOfDay);
      if (candidate > after) {
        best = best === undefined ? candidate : Math.min(best, candidate);
        break;
      }
      gapCursor = secondOfDay;
    }
  }
  return best;
}

function firstAllowedTimeAfter(expression: ParsedExpression, threshold: number): number | undefined {
  for (const hour of expression.hours.values) {
    for (const minute of expression.minutes.values) {
      for (const second of expression.seconds.values) {
        const candidate = hour * 3600 + minute * 60 + second;
        if (candidate > threshold) {
          return candidate;
        }
      }
    }
  }
  return undefined;
}

function resolveWallTime(formatter: Intl.DateTimeFormat, date: LocalDate, secondOfDay: number): number {
  const desired: LocalParts = {
    ...date,
    hour: Math.floor(secondOfDay / 3600),
    minute: Math.floor((secondOfDay % 3600) / 60),
    second: secondOfDay % 60,
  };
  const wall = wallEpoch(desired);
  const offsets = offsetsNear(formatter, wall);
  const exact = [...offsets]
    .map(offset => wall - offset)
    .filter(candidate => sameLocal(localParts(formatter, candidate), desired))
    .toSorted((left, right) => left - right);
  const first = exact[0];
  if (first !== undefined) {
    return first;
  }

  // No instant owns this wall time: it is inside a forward offset transition.
  // Temporal's "compatible" rule uses the pre-transition offset, shifting the
  // local time forward by the size of the gap.
  return wall - Math.min(...offsets);
}

function offsetsNear(formatter: Intl.DateTimeFormat, wall: number): ReadonlySet<number> {
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    offsets.add(offsetAt(formatter, wall + hours * HOUR_MS));
  }
  return offsets;
}

function offsetAt(formatter: Intl.DateTimeFormat, instant: number): number {
  const rounded = Math.floor(instant / SECOND_MS) * SECOND_MS;
  return wallEpoch(localParts(formatter, rounded)) - rounded;
}

function wallEpoch(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function sameLocal(left: LocalParts, right: LocalParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function gapRanges(formatter: Intl.DateTimeFormat, date: LocalDate): readonly GapRange[] {
  const dayStart = Date.UTC(date.year, date.month - 1, date.day);
  const dayEnd = dayStart + DAY_MS;
  const scanStart = dayStart - 36 * HOUR_MS;
  const scanEnd = dayEnd + 36 * HOUR_MS;
  const ranges: GapRange[] = [];
  let previousInstant = scanStart;
  let previousOffset = offsetAt(formatter, previousInstant);

  for (let instant = scanStart + HOUR_MS; instant <= scanEnd; instant += HOUR_MS) {
    const currentOffset = offsetAt(formatter, instant);
    if (currentOffset !== previousOffset) {
      const transition = firstOffsetChange(formatter, previousInstant, instant, previousOffset);
      const afterOffset = offsetAt(formatter, transition);
      if (afterOffset > previousOffset) {
        const gapStart = wallEpoch(localParts(formatter, transition - SECOND_MS)) + SECOND_MS;
        const gapEnd = wallEpoch(localParts(formatter, transition));
        const intersectionStart = Math.max(dayStart, gapStart);
        const intersectionEnd = Math.min(dayEnd, gapEnd);
        if (intersectionStart < intersectionEnd) {
          ranges.push({
            startSecond: (intersectionStart - dayStart) / SECOND_MS,
            endSecond: (intersectionEnd - dayStart) / SECOND_MS,
          });
        }
      }
      previousOffset = currentOffset;
    }
    previousInstant = instant;
  }
  return ranges;
}

function firstOffsetChange(
  formatter: Intl.DateTimeFormat,
  lower: number,
  upper: number,
  previousOffset: number,
): number {
  let left = lower;
  let right = upper;
  while (right - left > SECOND_MS) {
    const middle = Math.floor((left + right) / (2 * SECOND_MS)) * SECOND_MS;
    if (offsetAt(formatter, middle) === previousOffset) {
      left = middle;
    } else {
      right = middle;
    }
  }
  return right;
}
