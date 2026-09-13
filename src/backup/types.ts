export const BACKUP_OPERATION_KINDS = [
  'export',
  'import',
  'managed_retention',
  'automatic_backup',
] as const;

export type BackupOperationKind = (typeof BACKUP_OPERATION_KINDS)[number];

export const BACKUP_OPERATION_STATES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export type BackupOperationState = (typeof BACKUP_OPERATION_STATES)[number];

export type BackupOperation = Readonly<{
  id: string;
  kind: BackupOperationKind;
  state: BackupOperationState;
  /** Opaque, versioned JSON owned by the operation handler. */
  payload: string;
  /** Opaque durable result of the last committed step. */
  checkpoint: string | null;
  activeStep: string | null;
  /** Stable idempotency key which must be used for every external mutation in this step. */
  activeStepKey: string | null;
  attempt: number;
  cancelRequested: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  version: number;
}>;

export type NewBackupOperation = Readonly<{
  id: string;
  kind: BackupOperationKind;
  payload: string;
}>;

export type OperationPatch = Readonly<{
  state?: BackupOperationState;
  checkpoint?: string | null;
  activeStep?: string | null;
  activeStepKey?: string | null;
  attempt?: number;
  cancelRequested?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  finishedAt?: string | null;
}>;

export type OperationStep = Readonly<{
  name: string;
}>;

export const createBackupOperationStepKey = (
  operationId: string,
  checkpoint: string | null,
  stepName: string,
) => `${operationId}:${checkpoint ?? 'start'}:${stepName}`;

export type StepContext = Readonly<{
  operation: BackupOperation;
  step: OperationStep;
  idempotencyKey: string;
}>;

export type StepResult =
  | Readonly<{ outcome: 'committed'; checkpoint: string; done?: boolean }>
  /** Explicitly guarantees that the step made no committed mutation. */
  | Readonly<{ outcome: 'retry'; code: string; message: string }>
  /** A known terminal failure which made no committed mutation. */
  | Readonly<{ outcome: 'failed'; code: string; message: string }>;

export type InterruptedStepResolution =
  | Readonly<{ outcome: 'committed'; checkpoint: string; done?: boolean }>
  | Readonly<{ outcome: 'not_committed' }>
  | Readonly<{ outcome: 'unknown'; code: string; message: string }>;

/**
 * Implementations own their checkpoint format. `runStep` must make external
 * mutations idempotent using `idempotencyKey`. Recovery must inspect external
 * state; it must never guess that an interrupted mutation did or did not commit.
 */
export interface BackupOperationHandler {
  nextStep(operation: BackupOperation): Promise<OperationStep | null>;
  runStep(context: StepContext): Promise<StepResult>;
  recoverInterruptedStep(context: StepContext): Promise<InterruptedStepResolution>;
}

export interface BackupOperationStore {
  create(operation: NewBackupOperation, now: string): Promise<BackupOperation>;
  get(id: string): Promise<BackupOperation | null>;
  getActive(): Promise<BackupOperation | null>;
  /** Return the newest attempt with an exact operation payload, if supported. */
  getLatestByKindAndPayload?: (
    kind: BackupOperationKind,
    payload: string,
  ) => Promise<BackupOperation | null>;
  update(
    id: string,
    expectedVersion: number,
    patch: OperationPatch,
    now: string,
  ): Promise<BackupOperation | null>;
}

export type CoordinatorOptions = Readonly<{
  maxAttemptsPerStep?: number;
  now?: () => string;
}>;

export class BackupOperationBusyError extends Error {
  readonly code = 'BACKUP_OPERATION_BUSY';

  constructor() {
    super('Another backup operation is already active');
    this.name = 'BackupOperationBusyError';
  }
}
