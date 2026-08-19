// 同步引擎：本地优先 + 增量双向同步（LWW）
// 流程：push 本地水位后的变更 → pull 服务端变更 → 本地 upsert（LWW）→ 更新水位
import { DeviceEventEmitter } from 'react-native';
import { LEDGER_EVENTS, SETTING_KEYS } from '../constants';
import { getDB, saveSetting, getSetting } from '../database/ledgerDB';
import { apiSyncPull, apiSyncPush, apiGetLedgers, getSyncConfig, ApiError } from './apiClient';
import type {
  SyncAccountDTO, SyncChanges, SyncCustomCategoryDTO, SyncRecordDTO,
  SyncRecurringDTO, SyncTransferDTO,
} from './serverTypes';

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  error?: string;
}

let syncing = false;

export function isSyncing(): boolean {
  return syncing;
}

// 解析当前同步账本 id（未显式选择 → 取个人账本兜底）
async function resolveActiveLedgerId(baseUrl: string, token: string): Promise<number> {
  const saved = await getSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_ID);
  const savedId = Number(saved ?? '0') || 0;
  if (savedId > 0) return savedId;
  const { ledgers } = await apiGetLedgers(baseUrl, token)
    .catch(() => ({ ledgers: [] as { type: string; id: number }[] }));
  const personal = ledgers.find((l) => l.type === 'personal');
  if (personal) {
    await saveSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_ID, String(personal.id));
  }
  return personal?.id ?? 0;
}

// 每本账本独立水位 key（避免个人/家庭切换后互相污染）
function watermarkKey(base: string, ledgerId: number): string {
  return `${base}.${ledgerId}`;
}

// ===== push：收集本地 updated_at > 水位 的变更 =====

async function collectPushChanges(sinceTs: number): Promise<{ changes: Partial<SyncChanges>; maxLocalTs: number }> {
  const db = await getDB();

  const records = await db.getAllAsync<SyncRecordDTO & { user_id: number }>(
    `SELECT uuid, user_id as userId, amount, category, type, note, date, timestamp,
            account_uuid as accountUuid, reimbursable, reimbursed, updated_at as updatedAt, deleted
     FROM ledger_records WHERE updated_at > ? AND uuid != '' ORDER BY updated_at ASC`,
    [sinceTs]
  );

  const accounts = await db.getAllAsync<SyncAccountDTO>(
    `SELECT uuid, name, type, emoji, color, initial_balance as initialBalance, 0 as sort,
            updated_at as updatedAt, deleted
     FROM accounts WHERE updated_at > ? AND uuid != '' ORDER BY updated_at ASC`,
    [sinceTs]
  );

  const transfers = await db.getAllAsync<SyncTransferDTO>(
    `SELECT uuid, from_account_uuid as fromAccountUuid, to_account_uuid as toAccountUuid,
            amount, date, note, timestamp, updated_at as updatedAt, deleted
     FROM transfers WHERE updated_at > ? AND uuid != '' ORDER BY updated_at ASC`,
    [sinceTs]
  );

  const recurring = await db.getAllAsync<SyncRecurringDTO & { user_id: number }>(
    `SELECT uuid, user_id as userId, name, amount, type, category, account_uuid as accountUuid,
            frequency, day_of_week as dayOfWeek, day_of_month as dayOfMonth, month_of_year as monthOfYear,
            note, enabled, last_generated as lastGenerated, updated_at as updatedAt, deleted
     FROM recurring_rules WHERE updated_at > ? AND uuid != '' ORDER BY updated_at ASC`,
    [sinceTs]
  );

  const customCategories = await db.getAllAsync<SyncCustomCategoryDTO>(
    `SELECT uuid, key, label, emoji, color, type, updated_at as updatedAt, deleted
     FROM custom_categories WHERE updated_at > ? AND uuid != '' ORDER BY updated_at ASC`,
    [sinceTs]
  );

  // 水位推进：本次推送行中的最大 updated_at
  let maxLocalTs = sinceTs;
  const rows = [...records, ...accounts, ...transfers, ...recurring, ...customCategories];
  for (const r of rows) {
    if (r.updatedAt > maxLocalTs) maxLocalTs = r.updatedAt;
  }

  return {
    changes: { records, accounts, transfers, recurring, customCategories },
    maxLocalTs,
  };
}

// ===== pull：服务端变更 → 本地 upsert（LWW）=====

async function applyPullChanges(changes: SyncChanges): Promise<number> {
  const db = await getDB();
  let applied = 0;

  // 1) 账户先行（其他实体依赖 uuid → 本地 id 映射）
  const uuidToLocalId = new Map<string, number>();
  const accountRows = await db.getAllAsync<{ id: number; uuid: string }>('SELECT id, uuid FROM accounts');
  for (const a of accountRows) uuidToLocalId.set(a.uuid, a.id);

  for (const acc of changes.accounts) {
    const local = await db.getFirstAsync<{ id: number; updated_at: number }>(
      'SELECT id, updated_at FROM accounts WHERE uuid = ?', [acc.uuid]
    );
    if (local) {
      if (acc.updatedAt > local.updated_at) {
        await db.runAsync(
          `UPDATE accounts SET name = ?, type = ?, emoji = ?, color = ?, initial_balance = ?, updated_at = ?, deleted = ? WHERE id = ?`,
          [acc.name, acc.type, acc.emoji, acc.color, acc.initialBalance, acc.updatedAt, acc.deleted, local.id]
        );
        applied++;
      }
      uuidToLocalId.set(acc.uuid, local.id);
    } else {
      const info = await db.runAsync(
        `INSERT INTO accounts (name, type, emoji, color, initial_balance, created_at, uuid, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [acc.name, acc.type, acc.emoji, acc.color, acc.initialBalance, Date.now(), acc.uuid, acc.updatedAt, acc.deleted]
      );
      uuidToLocalId.set(acc.uuid, Number(info.lastInsertRowId));
      applied++;
    }
  }

  const resolveAccountId = (uuid: string): number => uuidToLocalId.get(uuid) ?? 1;

  // 2) 记录
  for (const r of changes.records) {
    const local = await db.getFirstAsync<{ id: number; updated_at: number }>(
      'SELECT id, updated_at FROM ledger_records WHERE uuid = ?', [r.uuid]
    );
    const accountId = resolveAccountId(r.accountUuid);
    if (local) {
      if (r.updatedAt > local.updated_at) {
        await db.runAsync(
          `UPDATE ledger_records SET amount = ?, category = ?, type = ?, note = ?, date = ?, timestamp = ?,
           account_id = ?, account_uuid = ?, reimbursable = ?, reimbursed = ?, user_id = ?, updated_at = ?, deleted = ?
           WHERE id = ?`,
          [r.amount, r.category, r.type, r.note, r.date, r.timestamp,
           accountId, r.accountUuid, r.reimbursable, r.reimbursed, r.userId, r.updatedAt, r.deleted, local.id]
        );
        applied++;
      }
    } else {
      await db.runAsync(
        `INSERT INTO ledger_records (amount, category, type, note, date, timestamp, account_id, reimbursable, reimbursed, uuid, user_id, updated_at, deleted, account_uuid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.amount, r.category, r.type, r.note, r.date, r.timestamp,
         accountId, r.reimbursable, r.reimbursed, r.uuid, r.userId, r.updatedAt, r.deleted, r.accountUuid]
      );
      applied++;
    }
  }

  // 3) 转账
  for (const t of changes.transfers) {
    const local = await db.getFirstAsync<{ id: number; updated_at: number }>(
      'SELECT id, updated_at FROM transfers WHERE uuid = ?', [t.uuid]
    );
    const fromId = resolveAccountId(t.fromAccountUuid);
    const toId = resolveAccountId(t.toAccountUuid);
    if (local) {
      if (t.updatedAt > local.updated_at) {
        await db.runAsync(
          `UPDATE transfers SET from_account_id = ?, to_account_id = ?, amount = ?, date = ?, note = ?,
           from_account_uuid = ?, to_account_uuid = ?, updated_at = ?, deleted = ? WHERE id = ?`,
          [fromId, toId, t.amount, t.date, t.note, t.fromAccountUuid, t.toAccountUuid, t.updatedAt, t.deleted, local.id]
        );
        applied++;
      }
    } else {
      await db.runAsync(
        `INSERT INTO transfers (from_account_id, to_account_id, amount, date, note, timestamp, uuid, updated_at, deleted, from_account_uuid, to_account_uuid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [fromId, toId, t.amount, t.date, t.note, t.timestamp, t.uuid, t.updatedAt, t.deleted, t.fromAccountUuid, t.toAccountUuid]
      );
      applied++;
    }
  }

  // 4) 周期规则
  for (const r of changes.recurring) {
    const local = await db.getFirstAsync<{ id: number; updated_at: number }>(
      'SELECT id, updated_at FROM recurring_rules WHERE uuid = ?', [r.uuid]
    );
    const accountId = resolveAccountId(r.accountUuid);
    if (local) {
      if (r.updatedAt > local.updated_at) {
        await db.runAsync(
          `UPDATE recurring_rules SET name = ?, amount = ?, type = ?, category = ?, account_id = ?, account_uuid = ?,
           frequency = ?, day_of_week = ?, day_of_month = ?, month_of_year = ?, note = ?, enabled = ?,
           last_generated = ?, user_id = ?, updated_at = ?, deleted = ? WHERE id = ?`,
          [r.name, r.amount, r.type, r.category, accountId, r.accountUuid, r.frequency,
           r.dayOfWeek, r.dayOfMonth, r.monthOfYear, r.note, r.enabled, r.lastGenerated, r.userId, r.updatedAt, r.deleted, local.id]
        );
        applied++;
      }
    } else {
      await db.runAsync(
        `INSERT INTO recurring_rules (name, amount, type, category, account_id, frequency, day_of_week, day_of_month, month_of_year, note, enabled, last_generated, created_at, uuid, user_id, updated_at, deleted, account_uuid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.name, r.amount, r.type, r.category, accountId, r.frequency, r.dayOfWeek, r.dayOfMonth,
         r.monthOfYear, r.note, r.enabled, r.lastGenerated, Date.now(), r.uuid, r.userId, r.updatedAt, r.deleted, r.accountUuid]
      );
      applied++;
    }
  }

  // 5) 自定义分类
  for (const c of changes.customCategories) {
    const local = await db.getFirstAsync<{ key: string; updated_at: number }>(
      'SELECT key, updated_at FROM custom_categories WHERE uuid = ?', [c.uuid]
    );
    if (local) {
      if (c.updatedAt > local.updated_at) {
        await db.runAsync(
          `UPDATE custom_categories SET key = ?, label = ?, emoji = ?, color = ?, type = ?, updated_at = ?, deleted = ? WHERE key = ?`,
          [c.key, c.label, c.emoji, c.color, c.type, c.updatedAt, c.deleted, local.key]
        );
        applied++;
      }
    } else {
      await db.runAsync(
        `INSERT INTO custom_categories (key, label, emoji, color, type, created_at, uuid, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.key, c.label, c.emoji, c.color, c.type, Date.now(), c.uuid, c.updatedAt, c.deleted]
      );
      applied++;
    }
  }

  return applied;
}

// ===== 主入口：执行一轮 push + pull =====

export async function runSync(): Promise<SyncResult> {
  const config = await getSyncConfig();
  if (!config) {
    return { ok: false, pushed: 0, pulled: 0, error: '未配置同步' };
  }
  if (syncing) {
    return { ok: false, pushed: 0, pulled: 0, error: '同步进行中' };
  }
  syncing = true;
  try {
    // --- 确定当前账本 ---
    const ledgerId = await resolveActiveLedgerId(config.baseUrl, config.token);
    if (!ledgerId) {
      return { ok: false, pushed: 0, pulled: 0, error: '未选择账本，请在同步页选择个人/家庭账本' };
    }

    // --- push ---
    const lastPushStr = await getSetting(watermarkKey(SETTING_KEYS.SYNC_LAST_PUSH_AT, ledgerId));
    const lastPushAt = Number(lastPushStr ?? '0') || 0;
    const { changes, maxLocalTs } = await collectPushChanges(lastPushAt);
    const pushCount = Object.values(changes).reduce((s, arr) => s + (arr?.length ?? 0), 0);
    if (pushCount > 0) {
      const pushRes = await apiSyncPush(config.baseUrl, config.token, changes, ledgerId);
      await saveSetting(watermarkKey(SETTING_KEYS.SYNC_LAST_PUSH_AT, ledgerId), String(maxLocalTs));
      // 首次登录/老用户：同步即视为已确认归属，后续无需重复 claim
    } else {
      // 无变更也推进水位（本地无新数据时水位无意义，保持）
    }

    // --- pull ---
    const lastPullStr = await getSetting(watermarkKey(SETTING_KEYS.SYNC_LAST_PULL_AT, ledgerId));
    const lastPullAt = Number(lastPullStr ?? '0') || 0;
    const pullRes = await apiSyncPull(config.baseUrl, config.token, lastPullAt, ledgerId);
    const pulled = await applyPullChanges(pullRes.changes);
    await saveSetting(watermarkKey(SETTING_KEYS.SYNC_LAST_PULL_AT, ledgerId), String(pullRes.serverTime));
    await saveSetting(SETTING_KEYS.SYNC_LAST_SYNC_TIME, String(Date.now()));

    // 有数据落库 → 通知页面刷新
    if (pulled > 0) {
      const { setCustomCategoriesCache } = await import('../database/ledgerDB');
      await setCustomCategoriesCache();
      DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
      DeviceEventEmitter.emit(LEDGER_EVENTS.ACCOUNTS_CHANGED);
    }

    // 刷新家庭成员缓存（成员增减/改名后各端标识同步，v0.5）
    try {
      const { refreshMembersCache } = await import('./memberUtils');
      await refreshMembersCache(config.baseUrl, config.token);
    } catch {
      // 成员缓存失败不影响同步主流程
    }

    return { ok: true, pushed: pushCount, pulled };
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : '同步失败';
    return { ok: false, pushed: 0, pulled: 0, error: msg };
  } finally {
    syncing = false;
    // 一轮同步结束（无论成败）→ 通知 UI 刷新同步状态与成员缓存（v0.5）
    DeviceEventEmitter.emit(LEDGER_EVENTS.SYNC_DONE);
  }
}

// 登录后归属：本地 user_id=0 的记录划归当前用户（记账人标记）
export async function claimLocalRecordsAsUser(userId: number): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    'UPDATE ledger_records SET user_id = ? WHERE user_id = 0 AND deleted = 0',
    [userId]
  );
}

// 墓碑清理：删除 90 天前的墓碑行（启动时调用，避免本地库无限膨胀）
export async function purgeOldTombstones(): Promise<void> {
  const db = await getDB();
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
  await db.runAsync('DELETE FROM ledger_records WHERE deleted = 1 AND updated_at < ?', [cutoff]);
  await db.runAsync('DELETE FROM accounts WHERE deleted = 1 AND updated_at < ?', [cutoff]);
  await db.runAsync('DELETE FROM transfers WHERE deleted = 1 AND updated_at < ?', [cutoff]);
  await db.runAsync('DELETE FROM recurring_rules WHERE deleted = 1 AND updated_at < ?', [cutoff]);
  await db.runAsync('DELETE FROM custom_categories WHERE deleted = 1 AND updated_at < ?', [cutoff]);
}
