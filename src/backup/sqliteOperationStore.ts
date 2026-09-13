import { getDb, withSqliteBusyRetry } from '../database/schema';
import {
  BackupOperationBusyError,
  type BackupOperation,
  type BackupOperationKind,
  type BackupOperationState,
  type BackupOperationStore,
  type NewBackupOperation,
  type OperationPatch,
} from './types';

type OperationRow = {
  id: string;
  kind: BackupOperationKind;
  state: BackupOperationState;
  payload: string;
  checkpoint: string | null;
  activeStep: string | null;
  activeStepKey: string | null;
  attempt: number;
  cancelRequested: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  version: number;
};

const selectColumns = `id, kind, state, payload, checkpoint, activeStep, activeStepKey,
  attempt, cancelRequested, errorCode, errorMessage, createdAt, updatedAt, finishedAt, version`;

const fromRow = (row: OperationRow): BackupOperation => ({
  ...row,
  cancelRequested: row.cancelRequested === 1,
});

export class SqliteBackupOperationStore implements BackupOperationStore {
  async create(operation: NewBackupOperation, now: string): Promise<BackupOperation> {
    const db = await getDb();
    try {
      await withSqliteBusyRetry(() => db.runAsync(
          `INSERT INTO BackupOperations
            (id, kind, state, payload, createdAt, updatedAt)
           VALUES (?, ?, 'pending', ?, ?, ?);`,
          [operation.id, operation.kind, operation.payload, now, now],
        ));
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new BackupOperationBusyError();
      }
      throw error;
    }
    const created = await this.get(operation.id);
    if (!created) throw new Error('Failed to read the created backup operation');
    return created;
  }

  async get(id: string): Promise<BackupOperation | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<OperationRow>(
      `SELECT ${selectColumns} FROM BackupOperations WHERE id = ?;`,
      [id],
    );
    return row ? fromRow(row) : null;
  }

  async getActive(): Promise<BackupOperation | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<OperationRow>(
      `SELECT ${selectColumns} FROM BackupOperations
       WHERE state IN ('pending', 'running') ORDER BY createdAt ASC LIMIT 1;`,
    );
    return row ? fromRow(row) : null;
  }

  async getLatest(): Promise<BackupOperation | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<OperationRow>(
      `SELECT ${selectColumns} FROM BackupOperations ORDER BY updatedAt DESC LIMIT 1;`,
    );
    return row ? fromRow(row) : null;
  }

  async getLatestByKindAndPayload(
    kind: BackupOperationKind,
    payload: string,
  ): Promise<BackupOperation | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<OperationRow>(
      `SELECT ${selectColumns} FROM BackupOperations
       WHERE kind = ? AND payload = ?
       ORDER BY updatedAt DESC, rowid DESC LIMIT 1;`,
      [kind, payload],
    );
    return row ? fromRow(row) : null;
  }

  async update(
    id: string,
    expectedVersion: number,
    patch: OperationPatch,
    now: string,
  ): Promise<BackupOperation | null> {
    const entries: ReadonlyArray<readonly [keyof OperationPatch, string]> = [
      ['state', 'state'], ['checkpoint', 'checkpoint'], ['activeStep', 'activeStep'],
      ['activeStepKey', 'activeStepKey'], ['attempt', 'attempt'],
      ['cancelRequested', 'cancelRequested'], ['errorCode', 'errorCode'],
      ['errorMessage', 'errorMessage'], ['finishedAt', 'finishedAt'],
    ];
    const included = entries.filter(([key]) => Object.prototype.hasOwnProperty.call(patch, key));
    const values: (string | number | null)[] = included.map(([key]) => {
      const value = patch[key];
      return typeof value === 'boolean' ? (value ? 1 : 0) : value ?? null;
    });
    const assignments = included.map(([, column]) => `${column} = ?`);
    assignments.push('updatedAt = ?', 'version = version + 1');
    values.push(now, id, expectedVersion);

    const db = await getDb();
    const result = await withSqliteBusyRetry(() => db.runAsync(
        `UPDATE BackupOperations SET ${assignments.join(', ')} WHERE id = ? AND version = ?;`,
        values,
      ));
    return result.changes === 1 ? this.get(id) : null;
  }
}
