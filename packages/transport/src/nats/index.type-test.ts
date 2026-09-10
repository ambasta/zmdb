// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { NodeConnectionOptions } from '@nats-io/transport-node';
import type { TransportErrorSink, TransportStrategy } from '@zmdb/app/messaging';

import type { NatsStrategyOptions, NatsSubscription, createNatsStrategy } from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

export type _SubscriptionKeys = Expect<Equal<keyof NatsSubscription, 'queue' | 'subject'>>;
export type _OptionsKeys = Expect<
  Equal<keyof NatsStrategyOptions, 'connection' | 'name' | 'onError' | 'subscriptions'>
>;
export type _ConnectionOption = Expect<Equal<NatsStrategyOptions['connection'], NodeConnectionOptions | undefined>>;
export type _ErrorSink = Expect<Equal<NatsStrategyOptions['onError'], TransportErrorSink>>;
export type _FactoryParameter = Expect<Equal<Parameters<typeof createNatsStrategy>, [NatsStrategyOptions]>>;
export type _FactoryReturn = Expect<Equal<ReturnType<typeof createNatsStrategy>, TransportStrategy>>;
