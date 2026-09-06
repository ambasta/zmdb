import type { ClientOptions } from '@zmdb/client';

export type GeneratedClientFactory<Client> = (options: ClientOptions) => Client;

export type SvelteKitClientOptions = Omit<ClientOptions, 'transport'>;
