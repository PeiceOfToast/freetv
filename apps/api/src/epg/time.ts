// Injectable clock for EPG routes. Tests call setNowFn(() => frozenSeconds) to freeze "now".
const defaultNow = () => Math.floor(Date.now() / 1000);
let nowFn: () => number = defaultNow;

/** Current unix time in seconds. */
export function nowSeconds(): number {
  return nowFn();
}

/** Replace the clock (tests). Pass null to restore the real clock. */
export function setNowFn(fn: (() => number) | null): void {
  nowFn = fn ?? defaultNow;
}
