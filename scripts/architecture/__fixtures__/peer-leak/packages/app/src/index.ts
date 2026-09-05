import { coreValue } from '@fixture/core';
import { peerValue } from 'fixture-peer';
import { runtimeValue } from 'fixture-runtime';

export const appValue = `${coreValue}:${runtimeValue}:${peerValue}`;
