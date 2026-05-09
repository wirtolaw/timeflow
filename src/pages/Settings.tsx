import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserId } from '../lib/supabase';
import type { Category } from '../lib/types';
import { format, subDays } from 'date-fns';

type ThemeMode = 'light' | 'dark' | 'system';

interface NotificationSettings {
  enabled: boolean;
  limitWarning: boolean;
  limitExceeded: boolean;
  continuousWork: boolean;
  forgottenTimer: boolean;
}

interface ContinuousWorkSettings {
  thresholdMinutes: number;
  exceptionCategories: string[];
}

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  limitWarning: true,
  limitExceeded: true,
  continuousWork: true,
  forgottenTimer: true,
};

const DEFAULT_CONTINUOUS: ContinuousWorkSettings = {
  thresholdMinutes: 120,
  exceptionCategories: [],
};

export function getNotificationSettings(): NotificationSettings {
  try {
    const stored = localStorage.getItem('tf_notifications');
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return DEFAULT_NOTIFICATIONS;
}

export function getContinuousWorkSettings(): ContinuousWorkSettings {
  try {
    const stored = localStorage.getItem('tf_continuous_work');
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return DEFAULT_CONTINUOUS;
}

export default function Settings() {
  const navigate = useNavigate();
  const userId = getUserId();

  // Theme
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem('tf_theme') as ThemeMode) || 'system';
  });

  // Notifications
  const [notifications, setNotifications] = useState<NotificationSettings>(() => getNotificationSettings());

  // Continuous work
  const [continuous, setContinuous] = useState<ContinuousWorkSettings>(() => getContinuousWorkSettings());

  // Categories for exception selection
  const [categories, setCategories] = useState<Category[]>([]);

  // Export
  const [exportTimeEntries, setExportTimeEntries] = useState(true);
  const [exportHabits, setExportHabits] = useState(false);
  const [exportPlans, setExportPlans] = useState(false);
  const [exportRange, setExportRange] = useState<'7' | '30' | '90' | 'all' | 'custom'>('30');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [exporting, setExporting] = useState(false);

  // Delete confirm
  const [deleteStep, setDeleteStep] = useState(0);

  const loadCategories = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_categories')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order');
    if (data) setCategories(data);
  }, [userId]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // Persist theme
  useEffect(() => {
    localStorage.setItem('tf_theme', theme);
    applyTheme(theme);
  }, [theme]);

  // Persist notifications
  useEffect(() => {
    localStorage.setItem('tf_notifications', JSON.stringify(notifications));
  }, [notifications]);

  // Persist continuous work
  useEffect(() => {
    localStorage.setItem('tf_continuous_work', JSON.stringify(continuous));
  }, [continuous]);

  const applyTheme = (mode: ThemeMode) => {
    const root = document.documentElement;
    if (mode === 'dark') {
      root.classList.add('dark');
    } else if (mode === 'light') {
      root.classList.remove('dark');
    } else {
      // system
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
  };

  const updateNotification = (key: keyof NotificationSettings, value: boolean) => {
    setNotifications((prev) => {
      if (key === 'enabled' && !value) {
        return { ...prev, enabled: false };
      }
      return { ...prev, [key]: value };
    });
  };

  const toggleExceptionCategory = (catName: string) => {
    setContinuous((prev) => {
      const list = prev.exceptionCategories.includes(catName)
        ? prev.exceptionCategories.filter((n) => n !== catName)
        : [...prev.exceptionCategories, catName];
      return { ...prev, exceptionCategories: list };
    });
  };

  // Export logic
  const handleExport = async () => {
    if (!userId) return;
    setExporting(true);

    let startDate: string | null = null;

    if (exportRange === '7') {
      startDate = subDays(new Date(), 7).toISOString();
    } else if (exportRange === '30') {
      startDate = subDays(new Date(), 30).toISOString();
    } else if (exportRange === '90') {
      startDate = subDays(new Date(), 90).toISOString();
    } else if (exportRange === 'custom' && customStart) {
      startDate = new Date(customStart).toISOString();
    }

    const csvParts: string[] = [];

    // Time entries
    if (exportTimeEntries) {
      let query = supabase
        .from('tf_time_entries')
        .select('*')
        .eq('user_id', userId)
        .not('end_time', 'is', null)
        .order('start_time');
      if (startDate) query = query.gte('start_time', startDate);
      if (exportRange === 'custom' && customEnd) {
        query = query.lte('start_time', new Date(customEnd).toISOString());
      }
      const { data } = await query;
      if (data && data.length > 0) {
        const lines = ['\uFEFF日期,开始时间,结束时间,时长(分钟),分类,项目,是否主任务'];
        for (const entry of data) {
          const cat = categories.find((c) => c.id === entry.category_id);
          const parent = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) : null;
          const catName = parent ? `${parent.name}/${cat!.name}` : (cat?.name ?? '');
          const start = new Date(entry.start_time);
          const end = new Date(entry.end_time);
          const mins = Math.round((end.getTime() - start.getTime()) / 60000);
          lines.push([
            format(start, 'yyyy-MM-dd'),
            format(start, 'HH:mm:ss'),
            format(end, 'HH:mm:ss'),
            mins,
            catName,
            entry.project_id ?? '',
            entry.is_primary ? '是' : '否',
          ].join(','));
        }
        csvParts.push(lines.join('\n'));
      }
    }

    // Habits
    if (exportHabits) {
      let query = supabase
        .from('tf_habit_logs')
        .select('*, tf_habits!inner(name, type, target_value)')
        .order('date');
      if (startDate) query = query.gte('date', format(new Date(startDate), 'yyyy-MM-dd'));
      if (exportRange === 'custom' && customEnd) {
        query = query.lte('date', customEnd);
      }
      const { data } = await query;
      if (data && data.length > 0) {
        const lines = ['\uFEFF日期,习惯名称,类型,目标值,实际值,是否达标'];
        for (const log of data) {
          const habit = (log as any).tf_habits;
          lines.push([
            log.date,
            habit?.name ?? '',
            habit?.type ?? '',
            habit?.target_value ?? '',
            log.actual_value,
            log.is_met ? '是' : '否',
          ].join(','));
        }
        csvParts.push(lines.join('\n'));
      }
    }

    // Plans
    if (exportPlans) {
      let query = supabase
        .from('tf_daily_plans')
        .select('*, tf_plan_blocks(*)')
        .eq('user_id', userId)
        .order('date');
      if (startDate) query = query.gte('date', format(new Date(startDate), 'yyyy-MM-dd'));
      if (exportRange === 'custom' && customEnd) {
        query = query.lte('date', customEnd);
      }
      const { data } = await query;
      if (data && data.length > 0) {
        const lines = ['\uFEFF日期,计划任务,计划时段,预估时长,实际时长,偏差%'];
        for (const plan of data) {
          const blocks = (plan as any).tf_plan_blocks ?? [];
          for (const block of blocks) {
            const est = block.estimated_minutes ?? 0;
            const act = block.actual_minutes ?? 0;
            const dev = est > 0 ? Math.round(((act - est) / est) * 100) : 0;
            lines.push([
              plan.date,
              block.task_name,
              `${block.start_time}-${block.end_time}`,
              est,
              act,
              `${dev}%`,
            ].join(','));
          }
        }
        csvParts.push(lines.join('\n'));
      }
    }

    if (csvParts.length > 0) {
      const csv = csvParts.join('\n\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `timeflow_export_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    setExporting(false);
  };

  // Clear all data
  const handleClearData = async () => {
    if (!userId) return;
    await supabase.from('tf_time_entries').delete().eq('user_id', userId);
    await supabase.from('tf_habit_logs').delete().in(
      'habit_id',
      (await supabase.from('tf_habits').select('id').eq('user_id', userId)).data?.map((h) => h.id) ?? []
    );
    await supabase.from('tf_habits').delete().eq('user_id', userId);
    await supabase.from('tf_plan_blocks').delete().in(
      'plan_id',
      (await supabase.from('tf_daily_plans').select('id').eq('user_id', userId)).data?.map((p) => p.id) ?? []
    );
    await supabase.from('tf_daily_plans').delete().eq('user_id', userId);
    await supabase.from('tf_projects').delete().eq('user_id', userId);
    await supabase.from('tf_categories').delete().eq('user_id', userId);
    localStorage.removeItem('tf_user_id');
    localStorage.removeItem('tf_theme');
    localStorage.removeItem('tf_notifications');
    localStorage.removeItem('tf_continuous_work');
    setDeleteStep(0);
    window.location.reload();
  };

  const parentCategories = categories.filter((c) => !c.parent_id);

  return (
    <div className="flex flex-col min-h-screen pb-16 bg-[var(--bg-secondary)]">
      {/* Header */}
      <div className="bg-gray-800 text-white px-4 py-4 flex items-center">
        <button onClick={() => navigate('/')} className="text-lg mr-3">
          ←
        </button>
        <h1 className="text-lg font-medium flex-1">设置</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* 外观 */}
        <section className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">外观</h2>
          <div className="flex gap-2">
            {([['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']] as [ThemeMode, string][]).map(
              ([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setTheme(mode)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    theme === mode
                      ? 'bg-gray-800 text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                  }`}
                >
                  {label}
                </button>
              )
            )}
          </div>
        </section>

        {/* 通知 */}
        <section className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">通知</h2>
          <div className="space-y-3">
            <ToggleRow
              label="启用通知"
              checked={notifications.enabled}
              onChange={(v) => updateNotification('enabled', v)}
            />
            {notifications.enabled && (
              <>
                <ToggleRow
                  label="限制型习惯预警 (80%)"
                  checked={notifications.limitWarning}
                  onChange={(v) => updateNotification('limitWarning', v)}
                />
                <ToggleRow
                  label="限制型习惯超限 (100%)"
                  checked={notifications.limitExceeded}
                  onChange={(v) => updateNotification('limitExceeded', v)}
                />
                <ToggleRow
                  label="连续工作提醒"
                  checked={notifications.continuousWork}
                  onChange={(v) => updateNotification('continuousWork', v)}
                />
                <ToggleRow
                  label="遗忘计时器提醒 (>=4h)"
                  checked={notifications.forgottenTimer}
                  onChange={(v) => updateNotification('forgottenTimer', v)}
                />
              </>
            )}
          </div>
        </section>

        {/* 连续工作提醒设置 */}
        {notifications.enabled && notifications.continuousWork && (
          <section className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)]">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">连续工作提醒设置</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--text-secondary)] block mb-1">
                  阈值（分钟）
                </label>
                <input
                  type="number"
                  value={continuous.thresholdMinutes}
                  onChange={(e) =>
                    setContinuous((prev) => ({
                      ...prev,
                      thresholdMinutes: parseInt(e.target.value) || 120,
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-sm bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-secondary)] block mb-1">
                  例外分类（不提醒）
                </label>
                <div className="flex flex-wrap gap-2">
                  {parentCategories.map((cat) => {
                    const isSelected = continuous.exceptionCategories.includes(cat.name);
                    return (
                      <button
                        key={cat.id}
                        onClick={() => toggleExceptionCategory(cat.name)}
                        className={`px-2.5 py-1 rounded-full text-xs transition-colors border ${
                          isSelected
                            ? 'border-transparent text-white'
                            : 'border-[var(--border)] text-[var(--text-secondary)]'
                        }`}
                        style={isSelected ? { backgroundColor: cat.color } : undefined}
                      >
                        {cat.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 数据导出 */}
        <section className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">数据导出</h2>
          <div className="space-y-3">
            <div className="space-y-2">
              <CheckboxRow label="时间记录" checked={exportTimeEntries} onChange={setExportTimeEntries} />
              <CheckboxRow label="习惯记录" checked={exportHabits} onChange={setExportHabits} />
              <CheckboxRow label="计划对比" checked={exportPlans} onChange={setExportPlans} />
            </div>

            <div>
              <label className="text-xs text-[var(--text-secondary)] block mb-1">时间范围</label>
              <div className="flex flex-wrap gap-2">
                {([['7', '最近7天'], ['30', '最近30天'], ['90', '最近90天'], ['all', '全部'], ['custom', '自定义']] as const).map(
                  ([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setExportRange(val)}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        exportRange === val
                          ? 'bg-gray-800 text-white'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {label}
                    </button>
                  )
                )}
              </div>
            </div>

            {exportRange === 'custom' && (
              <div className="flex gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] text-xs bg-[var(--bg-primary)] text-[var(--text-primary)]"
                />
                <span className="text-[var(--text-secondary)] self-center text-xs">至</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] text-xs bg-[var(--bg-primary)] text-[var(--text-primary)]"
                />
              </div>
            )}

            <button
              onClick={handleExport}
              disabled={exporting || (!exportTimeEntries && !exportHabits && !exportPlans)}
              className="w-full py-2.5 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-40"
            >
              {exporting ? '导出中...' : '导出CSV'}
            </button>
          </div>
        </section>

        {/* 数据管理 */}
        <section className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">数据管理</h2>
          {deleteStep === 0 && (
            <button
              onClick={() => setDeleteStep(1)}
              className="w-full py-2.5 rounded-lg bg-red-50 text-red-600 text-sm font-medium dark:bg-red-900/20 dark:text-red-400"
            >
              清除所有数据
            </button>
          )}
          {deleteStep === 1 && (
            <div className="space-y-2">
              <p className="text-xs text-red-500">
                确定要清除所有数据吗？此操作不可撤销。
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteStep(2)}
                  className="flex-1 py-2.5 rounded-lg bg-red-500 text-white text-sm font-medium"
                >
                  确认清除
                </button>
                <button
                  onClick={() => setDeleteStep(0)}
                  className="flex-1 py-2.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-sm font-medium"
                >
                  取消
                </button>
              </div>
            </div>
          )}
          {deleteStep === 2 && (
            <div className="space-y-2">
              <p className="text-xs text-red-600 font-semibold">
                最后确认！所有时间记录、习惯、计划都将被永久删除。
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleClearData}
                  className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm font-bold"
                >
                  永久删除
                </button>
                <button
                  onClick={() => setDeleteStep(0)}
                  className="flex-1 py-2.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-sm font-medium"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---- Helper components ----

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[var(--text-primary)]">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5.5 rounded-full transition-colors ${
          checked ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white transition-transform shadow ${
            checked ? 'translate-x-4.5' : ''
          }`}
        />
      </button>
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded accent-gray-800"
      />
      <span className="text-sm text-[var(--text-primary)]">{label}</span>
    </label>
  );
}
