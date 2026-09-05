export interface Account {
  readonly id: string;
  readonly displayName: string;
  readonly authenticated: boolean;
}

export interface AcceptedAccount {
  readonly jobId: string;
  readonly authenticated: boolean;
}
