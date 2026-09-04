import { ClientError } from '@zmdb/client';

export class SvelteAdapterError extends ClientError {
  constructor(message: string) {
    super(message);
    this.name = 'SvelteAdapterError';
  }
}
