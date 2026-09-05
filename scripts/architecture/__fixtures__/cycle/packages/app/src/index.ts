import { coreValue } from '@fixture/core';
import { runtimeValue } from 'fixture-runtime';

export interface AppContract {
  readonly name: string;
}

export const appValue = `${coreValue}:${runtimeValue}`;
