import { expect, test } from 'vitest';
import { PACKAGE_NAME } from './index';

test('package entry point resolves', () => {
  expect(PACKAGE_NAME).toBe('@sps/data');
});
