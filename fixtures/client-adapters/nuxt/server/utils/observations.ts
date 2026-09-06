export interface RequestObservation {
  readonly authorization: string | null;
  readonly hiddenCookie: string | null;
  readonly hiddenHeader: string | null;
  readonly id: string;
  readonly session: string | null;
}

const observations: RequestObservation[] = [];

export function recordObservation(observation: RequestObservation): void {
  observations.push(Object.freeze({ ...observation }));
}

export function requestObservations(): readonly RequestObservation[] {
  return Object.freeze(observations.map(observation => Object.freeze({ ...observation })));
}
