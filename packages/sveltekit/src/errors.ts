import { ClientError } from '@zmdb/client';

export class SvelteKitAdapterError extends ClientError {
  constructor(message: string) {
    super(message);
    this.name = 'SvelteKitAdapterError';
  }
}
