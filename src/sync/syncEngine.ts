// 同步引擎：本地优先 + 增量双向同步（LWW）
// 流程：push 本地水位后的变更 → pull 服务端变更 → 本地 upsert（LWW）→ 更新水位
import { DeviceEventEmitter } from 'react-native';
import { LEDGER_EVENTS, SETTING_KEYS } from '../constants';
import { showToast } from '../components/Toast';
import {
  getDB,
  saveSetting,
  getSetting,
  getActiveLedgerId,
  setActiveLedgerId,
  adoptUnassignedRowsIntoLedger,
} from '../database/ledgerDB';
import { apiSyncPull, apiSyncPush, apiGetLedgers, getSyncConfig, ApiError } from './apiClient';
import type { SyncChanges, SyncCustomCategoryDTO, SyncRecordDTO, SyncRecurringDTO } from './serverTypes';

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  /** 因字段超出服务端限制而没能上传的条数（本地已存、家人看不到，需要如实提示） */
  invalid?: number;
  invalidIds?: string[];
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
  const { ledgers } = await apiGetLedgers(baseUrl, token).catch((e) => {
    // 凭证失效（401）交给主 catch 清理登录态，不再吞掉
    if (e instanceof ApiError && e.status === 401) throw e;
    return { ledgers: [] as { type: string; id: number }[] };
  });
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

async function collectPushChanges(
  sinceTs: number,
): Promise<{ changes: Partial<SyncChanges>; maxLocalTs: number }> {
  const db = await getDB();
  const ledgerId = getActiveLedgerId();

  const records = await db.getAllAsync<SyncRecordDTO & { user_id: number }>(
    `SELECT uuid, user_id as userId, amount, category, type, note, date, timestamp,
            reimbursable, reimbursed, updated_at as updatedAt, deleted
     FROM ledger_records WHERE updated_at > ? AND uuid != '' AND ledger_id = ? ORDER BY updated_at ASC`,
    [sinceTs, ledgerId],
  );

  const recurring = await db.getAllAsync<SyncRecurringDTO & { user_id: number }>(
    `SELECT uuid, user_id as userId, name, amount, type, category,
            frequency, day_of_week as dayOfWeek, day_of_month as dayOfMonth, month_of_year as monthOfYear,
            note, enabled, last_generated as lastGenerated, updated_at as updatedAt, deleted
     FROM recurring_rules WHERE updated_at > ? AND uuid != '' AND ledger_id = ? ORDER BY updated_at ASC`,
    [sinceTs, ledgerId],
  );

  const customCategories = await db.getAllAsync<SyncCustomCategoryDTO>(
    `SELECT uuid, key, label, emoji, color, type, updated_at as updatedAt, deleted
     FROM custom_categories WHERE updated_at > ? AND uuid != '' AND ledger_id = ? ORDER BY updated_at ASC`,
    [sinceTs, ledgerId],
  );

  // 水位推进：本次推送行中的最大 updated_at
  let maxLocalTs = sinceTs;
  const rows = [...records, ...recurring, ...customCategories];
  for (const r of rows) {
    if (r.updatedAt > maxLocalTs) maxLocalTs = r.updatedAt;
  }

  return {
    changes: { records, recurring, customCategories },
    maxLocalTs,
  };
}

// ===== pull：服务端变更 → 本地 upsert（LWW）=====

async function applyPullChanges(changes: SyncChanges): Promise<number> {
  const db = await getDB();
  const activeLedger = getActiveLedgerId();
  let applied = 0;
  // 整体包事务：任一条失败即整体回滚，避免半程写入导致下次漏拉（水位不一致）
  await db.withTransactionAsync(async () => {
    // 查找一律带 ledger_id：uuid 在本地没有唯一约束、也不分账本，
    // 少了这个条件，家庭账本的 pull 会改写个人账本里的同 uuid 行（与服务端同源的问题）
    // 1) 记录
    for (const r of changes.records) {
      const local = await db.getFirstAsync<{ id: number; updated_at: number }>(
        'SELECT id, updated_at FROM ledger_records WHERE uuid = ? AND ledger_id = ?',
        [r.uuid, activeLedger],
      );
      if (local) {
        if (r.updatedAt > local.updated_at) {
          await db.runAsync(
            `UPDATE ledger_records SET amount = ?, category = ?, type = ?, note = ?, date = ?, timestamp = ?,
             reimbursable = ?, reimbursed = ?, user_id = ?, updated_at = ?, deleted = ?
             WHERE id = ?`,
            [
              r.amount,
              r.category,
              r.type,
              r.note,
              r.date,
              r.timestamp,
              r.reimbursable,
              r.reimbursed,
              r.userId,
              r.updatedAt,
              r.deleted,
              local.id,
            ],
          );
          applied++;
        }
      } else {
        await db.runAsync(
          `INSERT INTO ledger_records (amount, category, type, note, date, timestamp, reimbursable, reimbursed, uuid, user_id, updated_at, deleted, ledger_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.amount,
            r.category,
            r.type,
            r.note,
            r.date,
            r.timestamp,
            r.reimbursable,
            r.reimbursed,
            r.uuid,
            r.userId,
            r.updatedAt,
            r.deleted,
            activeLedger,
          ],
        );
        applied++;
      }
    }

    // 2) 周期规则
    for (const r of changes.recurring) {
      const local = await db.getFirstAsync<{ id: number; updated_at: number }>(
        'SELECT id, updated_at FROM recurring_rules WHERE uuid = ? AND ledger_id = ?',
        [r.uuid, activeLedger],
      );
      if (local) {
        if (r.updatedAt > local.updated_at) {
          await db.runAsync(
            `UPDATE recurring_rules SET name = ?, amount = ?, type = ?, category = ?,
             frequency = ?, day_of_week = ?, day_of_month = ?, month_of_year = ?, note = ?, enabled = ?,
             last_generated = ?, user_id = ?, updated_at = ?, deleted = ? WHERE id = ?`,
            [
              r.name,
              r.amount,
              r.type,
              r.category,
              r.frequency,
              r.dayOfWeek,
              r.dayOfMonth,
              r.monthOfYear,
              r.note,
              r.enabled,
              r.lastGenerated,
              r.userId,
              r.updatedAt,
              r.deleted,
              local.id,
            ],
          );
          applied++;
        }
      } else {
        await db.runAsync(
          `INSERT INTO recurring_rules (name, amount, type, category, frequency, day_of_week, day_of_month, month_of_year, note, enabled, last_generated, created_at, uuid, user_id, updated_at, deleted, ledger_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.name,
            r.amount,
            r.type,
            r.category,
            r.frequency,
            r.dayOfWeek,
            r.dayOfMonth,
            r.monthOfYear,
            r.note,
            r.enabled,
            r.lastGenerated,
            Date.now(),
            r.uuid,
            r.userId,
            r.updatedAt,
            r.deleted,
            activeLedger,
          ],
        );
        applied++;
      }
    }

    // 3) 自定义分类：主键是 (key, ledger_id)，改名会换主键 → 先按 uuid 清掉同账本里的旧 key 行，
    //    再按 (key, ledger_id) 做 LWW upsert。此前是 ON CONFLICT(key) DO NOTHING：
    //    另一本账本已有同 key 分类时这条会被永久吞掉（本地永远看不到，服务端每轮都还带着它）。
    for (const c of changes.customCategories) {
      const renamed = await db.getFirstAsync<{ rowid: number; updated_at: number }>(
        'SELECT rowid, updated_at FROM custom_categories WHERE uuid = ? AND key <> ? AND ledger_id = ?',
        [c.uuid, c.key, activeLedger],
      );
      if (renamed && c.updatedAt > renamed.updated_at) {
        await db.runAsync('DELETE FROM custom_categories WHERE rowid = ?', [renamed.rowid]);
        applied++;
      }
      const res = await db.runAsync(
        `INSERT INTO custom_categories (key, uuid, ledger_id, label, emoji, color, type, created_at, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key, ledger_id) DO UPDATE SET
           uuid = excluded.uuid, label = excluded.label, emoji = excluded.emoji, color = excluded.color,
           type = excluded.type, updated_at = excluded.updated_at, deleted = excluded.deleted
         WHERE excluded.updated_at > custom_categories.updated_at`,
        [c.key, c.uuid, activeLedger, c.label, c.emoji, c.color, c.type, Date.now(), c.updatedAt, c.deleted],
      );
      if (res.changes > 0) applied++;
    }
  });

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
    // 解析/切换活动账本后：DB 层读写限定到该账本，并把本地未归属存量一次性认领进来（幂等）
    setActiveLedgerId(ledgerId);
    await adoptUnassignedRowsIntoLedger(ledgerId);

    // --- push ---
    const lastPushStr = await getSetting(watermarkKey(SETTING_KEYS.SYNC_LAST_PUSH_AT, ledgerId));
    const lastPushAt = Number(lastPushStr ?? '0') || 0;
    const { changes, maxLocalTs } = await collectPushChanges(lastPushAt);
    const pushCount = Object.values(changes).reduce((s, arr) => s + (arr?.length ?? 0), 0);
    let invalid = 0;
    let invalidIds: string[] | undefined;
    if (pushCount > 0) {
      const pushRes = await apiSyncPush(config.baseUrl, config.token, changes, ledgerId);
      // v0.11.8：此前完全不看 push 响应，字段超限被服务端拒收时本地水位照样推进，
      // 那条数据就永远停在「我有、家人没有」且没有任何提示。
      invalid = pushRes.invalid ?? 0;
      invalidIds = pushRes.invalidIds;
      // 水位仍然推进：不推进会让这条每轮同步重发一次、每轮都被拒，同步彻底卡死。
      // 真正的修复是导入/录入入口已按服务端上限归一（见 exportData.SERVER_LIMITS），
      // 这里只把残余的异常如实报给 UI。
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
    }

    // 刷新家庭成员缓存（成员增减/改名后各端标识同步，v0.5）
    try {
      const { refreshMembersCache } = await import('./memberUtils');
      await refreshMembersCache(config.baseUrl, config.token);
    } catch {
      // 成员缓存失败不影响同步主流程
    }

    return { ok: true, pushed: pushCount, pulled, invalid, invalidIds };
  } catch (e) {
    // 凭证失效（401）→ 自动清理登录态并通知 UI，避免同步静默失败、用户却以为仍登录
    // （v0.11.3；服务端 0.5.5 起默认 365 天长效）
    //
    // v0.11.11：把服务端给的**具体原因**原样透出来，并主动弹提示。
    // 三种 401 的处置方式完全不同，此前统一压成「登录已过期，请到同步页重新登录」，
    // 结果「服务端账号不见了」这种要紧的事和「token 到期了，重登就好」长得一模一样：
    //  · 登录已过期，请重新登录      = token 到期，或服务端换过 JWT_SECRET（全员一起掉线通常是这个）
    //  · 登录状态已在其他设备变更     = 有人在别处改了密码（token_version 递增，属预期）
    //  · 用户不存在                 = 服务端账号/数据库不见了（换 DATA_DIR、卷没挂上、从备份回滚）
    if (e instanceof ApiError && e.status === 401) {
      const reason = (e.message || '').trim() || '登录状态失效';
      const accountMissing = reason.includes('用户不存在');
      await Promise.all([
        saveSetting(SETTING_KEYS.SYNC_TOKEN, ''),
        saveSetting(SETTING_KEYS.SYNC_USER_ID, '0'),
        saveSetting(SETTING_KEYS.SYNC_USER_DISPLAY, ''),
        saveSetting(SETTING_KEYS.SYNC_USER_AVATAR, ''),
        saveSetting(SETTING_KEYS.SYNC_FAMILY_NAME, ''),
        saveSetting(SETTING_KEYS.SYNC_MEMBERS_JSON, ''),
        saveSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_ID, '0'),
        saveSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_NAME, ''),
      ]);
      setActiveLedgerId(0);
      DeviceEventEmitter.emit(LEDGER_EVENTS.AUTH_CHANGED);
      // 后台自动同步这条路径原本没有任何 UI 出口（返回值被 debounce 丢弃），
      // 用户只会发现"不知道什么时候被退出了"。这里补一次明确的提示。
      showToast(
        accountMissing
          ? '⚠️ 服务端查不到此账号（本地账本仍在）。请先检查 NAS 上的数据卷/数据库是否还在，再决定是否重新注册'
          : `登录已失效：${reason}。本地账本仍在，重新登录即可继续同步`,
        'error',
        6000,
      );
      return { ok: false, pushed: 0, pulled: 0, error: reason };
    }
    const msg = e instanceof ApiError ? e.message : '同步失败';
    return { ok: false, pushed: 0, pulled: 0, error: msg };
  } finally {
    syncing = false;
    // 一轮同步结束（无论成败）→ 通知 UI 刷新同步状态与成员缓存（v0.5）
    DeviceEventEmitter.emit(LEDGER_EVENTS.SYNC_DONE);
  }
}

// 登录后归属：本地未记账人的存量（user_id=0）划归当前用户（记账人标记）
// 只处理「尚未归属任何账本」的那批（ledger_id=0，登录后会被 adopt 进当前账本）；
// 不加这个条件时，另一本账本里别人留下的无主记录也会被一起标成我的，报销对账口径就错了。
export async function claimLocalRecordsAsUser(userId: number): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    'UPDATE ledger_records SET user_id = ? WHERE user_id = 0 AND deleted = 0 AND ledger_id = 0',
    [userId],
  );
}

// 墓碑清理：删除 90 天前的墓碑行（启动时调用，避免本地库无限膨胀）
export async function purgeOldTombstones(): Promise<void> {
  const db = await getDB();
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
  await db.runAsync('DELETE FROM ledger_records WHERE deleted = 1 AND updated_at < ?', [cutoff]);
  await db.runAsync('DELETE FROM recurring_rules WHERE deleted = 1 AND updated_at < ?', [cutoff]);
  await db.runAsync('DELETE FROM custom_categories WHERE deleted = 1 AND updated_at < ?', [cutoff]);
}
