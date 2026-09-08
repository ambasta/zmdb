import { is, validate } from '@zmdb/validator';

export interface Message {
  readonly id: number;
  readonly address: string;
}

export function isMessage(value: unknown): boolean {
  return is<Message>(value);
}

export function validateMessage(value: unknown) {
  return validate<Message>(value);
}
