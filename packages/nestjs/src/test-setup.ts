import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, vi } from 'vitest';

// Tests read what Porter logged from this spy instead of the console.
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
