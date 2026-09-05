export interface Account {
  readonly id: string;
  readonly displayName: string;
}

export interface AcceptedAccount {
  readonly jobId: string;
}

export interface Health {
  readonly ok: boolean;
}
