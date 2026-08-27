/** Converts Unix milliseconds to a Prisma-compatible Date. */
export function toDate(milliseconds: number): Date {
    const date = new Date(milliseconds);
    if (!Number.isFinite(milliseconds) || Number.isNaN(date.getTime())) {
        throw new RangeError(`Invalid Unix timestamp: ${milliseconds}`);
    }
    return date;
}

/** Converts a database date into Unix milliseconds. */
export function toMilliseconds(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string' || typeof value === 'number') {
        const milliseconds = new Date(value).getTime();
        if (!Number.isNaN(milliseconds)) return milliseconds;
    }
    throw new Error('Prisma returned an invalid lease expiration');
}
