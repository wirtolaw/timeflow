import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, getUserId } from '../lib/supabase';
import type { Category, TimeEntry } from '../lib/types';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  addDays, subDays, addMonths, subMonths, format, isSameDay, differenceInMinutes,
  getDay, isBefore, isAfter, eachDayOfInterval,
} from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────

interface Habit {
  id: string;
  user_id: string;
  name: string;
  type: 'time_min' | 'time_max' | 'task_variety';
  category_id: string | null;
  target_value: number;
  frequency: 'daily' | 'weekly';
  exception_categories: string[] | null;
  phase_duration_days: number | null;
  phase_reduction: number | null;
  is_locked: boolean;
  created_at: string;
}

interface HabitLog {
  id: string;
  habit_id: string;
  date: string;
  actual_value: number;
  is_met: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function buildDescendantMap(categories: Category[]): Map<string, Set<string>> {
  const childrenMap = new Map<string, string[]>();
  for (const c of categories) {
    if (c.parent_id) {
      const arr = childrenMap.get(c.parent_id) || [];
      arr.push(c.id);
      childrenMap.set(c.parent_id, arr);
    }
  }
  const cache = new Map<string, Set<string>>();
  function collect(id: string): Set<string> {
    if (cache.has(id)) return cache.get(id)!;
    const s = new Set<string>([id]);
    for (const child of childrenMap.get(id) || []) {
      for (const d of collect(child)) s.add(d);
    }
    cache.set(id, s);
    return s;
  }
  for (const c of categories) collect(c.id);
  return cache;
}

function getRootCategory(categories: Category[], catId: string): Category | undefined {
  const catMap = new Map(categories.map(c => [c.id, c]));
  let cur = catMap.get(catId);
  while (cur && cur.parent_id) {
    cur = catMap.get(cur.parent_id);
  }
  return cur;
}

function durationMinutes(entry: TimeEntry, dayStart: Date, dayEnd: Date): number {
  const s = new Date(entry.start_time);
  const e = entry.end_time ? new Date(entry.end_time) : new Date();
  const clampedStart = isBefore(s, dayStart) ? dayStart : s;
  const clampedEnd = isAfter(e, dayEnd) ? dayEnd : e;
  return Math.max(0, differenceInMinutes(clampedEnd, clampedStart));
}

function getMonday(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 1 });
}

// ─── Seed habits ──────────────────────────────────────────────────────

const SEED_HABITS: Omit<Habit, 'id' | 'user_id' | 'created_at' | 'is_locked' | 'exception_categories' | 'phase_duration_days' | 'phase_reduction'>[] = [
  { name: '学法语', type: 'time_min', category_id: null, target_value: 60, frequency: 'daily' },
  { name: '找工作', type: 'time_min', category_id: null, target_value: 120, frequency: 'daily' },
  { name: '写小说', type: 'time_min', category_id: null, target_value: 180, frequency: 'weekly' },
  { name: 'SNS', type: 'time_max', category_id: null, target_value: 60, frequency: 'daily' },
  { name: '任务多样性', type: 'task_variety', category_id: null, target_value: 3, frequency: 'daily' },
];

// ─── Component ────────────────────────────────────────────────────────

export default function Habits() {
  const userId = getUserId();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calMonth, setCalMonth] = useState(new Date());
  const [expandedHabit, setExpandedHabit] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Add habit form
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<Habit['type']>('time_min');
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newTarget, setNewTarget] = useState('60');
  const [newFrequency, setNewFrequency] = useState<'daily' | 'weekly'>('daily');

  // Detail data
  const [detail30Logs, setDetail30Logs] = useState<HabitLog[]>([]);
  const [detail30Entries, setDetail30Entries] = useState<TimeEntry[]>([]);

  const descendantMap = useMemo(() => buildDescendantMap(categories), [categories]);

  // ─── Data loading ───────────────────────────────────────────────────

  const loadCategories = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_categories').select('*').eq('user_id', userId).order('sort_order');
    if (data) setCategories(data);
  }, [userId]);

  const loadHabits = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_habits').select('*').eq('user_id', userId).order('created_at');
    if (data) setHabits(data);
    return data;
  }, [userId]);

  const loadMonthEntries = useCallback(async () => {
    if (!userId) return;
    const ms = startOfMonth(calMonth);
    const me = endOfMonth(calMonth);
    const rangeStart = subDays(ms, 7);
    const rangeEnd = addDays(me, 7);
    const { data } = await supabase
      .from('tf_time_entries').select('*').eq('user_id', userId)
      .gte('start_time', rangeStart.toISOString())
      .lte('start_time', rangeEnd.toISOString())
      .not('end_time', 'is', null)
      .order('start_time');
    if (data) setEntries(data);
  }, [userId, calMonth]);

  const loadMonthLogs = useCallback(async () => {
    if (!userId || habits.length === 0) return;
    const ms = startOfMonth(calMonth);
    const me = endOfMonth(calMonth);
    const habitIds = habits.map(h => h.id);
    const { data } = await supabase
      .from('tf_habit_logs').select('*')
      .in('habit_id', habitIds)
      .gte('date', format(ms, 'yyyy-MM-dd'))
      .lte('date', format(me, 'yyyy-MM-dd'));
    if (data) setHabitLogs(data);
  }, [userId, habits, calMonth]);

  const loadDetailData = useCallback(async (habitId: string) => {
    if (!userId) return;
    const end = new Date();
    const start = subDays(end, 30);
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;

    const [logsRes, entriesRes] = await Promise.all([
      supabase.from('tf_habit_logs').select('*')
        .eq('habit_id', habitId)
        .gte('date', format(start, 'yyyy-MM-dd'))
        .lte('date', format(end, 'yyyy-MM-dd')),
      habit.category_id ? supabase.from('tf_time_entries').select('*')
        .eq('user_id', userId)
        .gte('start_time', start.toISOString())
        .lte('start_time', end.toISOString())
        .not('end_time', 'is', null) : Promise.resolve({ data: [] as TimeEntry[] }),
    ]);
    if (logsRes.data) setDetail30Logs(logsRes.data);
    if (entriesRes.data) setDetail30Entries(entriesRes.data as TimeEntry[]);
  }, [userId, habits]);

  // ─── Seeding ────────────────────────────────────────────────────────

  const seedHabits = useCallback(async () => {
    if (!userId) return;
    const catMap = new Map<string, Category>();
    for (const c of categories) {
      catMap.set(c.name, c);
    }
    const rows = SEED_HABITS.map(s => ({
      user_id: userId,
      name: s.name,
      type: s.type,
      category_id: catMap.get(s.name)?.id || null,
      target_value: s.target_value,
      frequency: s.frequency,
    }));
    await supabase.from('tf_habits').insert(rows);
    await loadHabits();
  }, [userId, categories, loadHabits]);

  // ─── Init ───────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      await loadCategories();
    })();
  }, [loadCategories]);

  useEffect(() => {
    if (categories.length === 0) return;
    (async () => {
      setLoading(true);
      const data = await loadHabits();
      if (data && data.length === 0) {
        await seedHabits();
      }
      setLoading(false);
    })();
  }, [categories]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadMonthEntries();
  }, [loadMonthEntries]);

  useEffect(() => {
    if (habits.length > 0) loadMonthLogs();
  }, [habits, loadMonthLogs]);

  // ─── Computation ────────────────────────────────────────────────────

  const computeActual = useCallback((habit: Habit, date: Date): number => {
    if (habit.type === 'task_variety') {
      const ds = startOfDay(date);
      const de = endOfDay(date);
      const dayEntries = entries.filter(e => {
        const s = new Date(e.start_time);
        return e.is_primary && s >= ds && s <= de;
      });
      const rootIds = new Set<string>();
      for (const e of dayEntries) {
        const root = getRootCategory(categories, e.category_id);
        if (root) rootIds.add(root.id);
      }
      return rootIds.size;
    }

    if (!habit.category_id) return 0;
    const catIds = descendantMap.get(habit.category_id) || new Set([habit.category_id]);

    const ds = startOfDay(date);
    const de = endOfDay(date);
    return entries.filter(e => {
      const s = new Date(e.start_time);
      return e.is_primary && catIds.has(e.category_id) && s >= ds && s <= de;
    }).reduce((sum, e) => sum + durationMinutes(e, ds, de), 0);
  }, [entries, categories, descendantMap]);

  const isHabitMet = useCallback((habit: Habit, date: Date): boolean => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const log = habitLogs.find(l => l.habit_id === habit.id && l.date === dateStr);
    if (log) return log.is_met;

    if (habit.frequency === 'weekly' && habit.name.includes('写小说')) {
      const weekStart = getMonday(date);
      const weekEnd = endOfWeek(date, { weekStartsOn: 1 });
      const catIds = habit.category_id
        ? (descendantMap.get(habit.category_id) || new Set([habit.category_id]))
        : new Set<string>();
      let daysWithEntry = 0;
      let deepSessions = 0;
      for (let d = weekStart; d <= weekEnd; d = addDays(d, 1)) {
        const ds = startOfDay(d);
        const de = endOfDay(d);
        const dayEntries = entries.filter(e => {
          const s = new Date(e.start_time);
          return e.is_primary && catIds.has(e.category_id) && s >= ds && s <= de;
        });
        if (dayEntries.length > 0) daysWithEntry++;
        for (const e of dayEntries) {
          if (durationMinutes(e, ds, de) >= 180) deepSessions++;
        }
      }
      return daysWithEntry >= 3 && deepSessions >= 2;
    }

    const actual = computeActual(habit, date);
    if (habit.type === 'time_max') return actual <= habit.target_value;
    return actual >= habit.target_value;
  }, [habitLogs, computeActual, entries, descendantMap]);

  // ─── Calendar data ──────────────────────────────────────────────────

  const calendarDays = useMemo(() => {
    const ms = startOfMonth(calMonth);
    const me = endOfMonth(calMonth);
    const days = eachDayOfInterval({ start: ms, end: me });

    let firstDow = getDay(ms);
    if (firstDow === 0) firstDow = 7;
    const padBefore = firstDow - 1;
    const prefix: (Date | null)[] = Array(padBefore).fill(null);

    let lastDow = getDay(me);
    if (lastDow === 0) lastDow = 7;
    const padAfter = 7 - lastDow;
    const suffix: (Date | null)[] = Array(padAfter).fill(null);

    return [...prefix, ...days, ...suffix];
  }, [calMonth]);

  const dayCompletionRate = useCallback((date: Date): number => {
    const dailyHabits = habits.filter(h => h.frequency === 'daily');
    if (dailyHabits.length === 0) return 0;
    const met = dailyHabits.filter(h => isHabitMet(h, date)).length;
    return met / dailyHabits.length;
  }, [habits, isHabitMet]);

  // ─── Streak ─────────────────────────────────────────────────────────

  const computeStreak = useCallback((habit: Habit): number => {
    if (habit.frequency === 'weekly') return 0;
    let streak = 0;
    let d = new Date();
    if (!isHabitMet(habit, d)) {
      return 0;
    }
    while (true) {
      if (isHabitMet(habit, d)) {
        streak++;
        d = subDays(d, 1);
        if (streak > 90) break;
      } else {
        break;
      }
    }
    return streak;
  }, [isHabitMet]);

  // ─── Writing habit weekly data ──────────────────────────────────────

  const getWritingWeekData = useCallback((habit: Habit, date: Date) => {
    const weekStart = getMonday(date);
    const weekEnd = endOfWeek(date, { weekStartsOn: 1 });
    const catIds = habit.category_id
      ? (descendantMap.get(habit.category_id) || new Set([habit.category_id]))
      : new Set<string>();
    let daysWithEntry = 0;
    let deepSessions = 0;
    for (let d = weekStart; d <= weekEnd; d = addDays(d, 1)) {
      const ds = startOfDay(d);
      const de = endOfDay(d);
      const dayEntries = entries.filter(e => {
        const s = new Date(e.start_time);
        return e.is_primary && catIds.has(e.category_id) && s >= ds && s <= de;
      });
      if (dayEntries.length > 0) daysWithEntry++;
      for (const e of dayEntries) {
        if (durationMinutes(e, ds, de) >= 180) deepSessions++;
      }
    }
    return { daysWithEntry, deepSessions };
  }, [entries, descendantMap]);

  // ─── Task variety root categories ───────────────────────────────────

  const getVarietyRoots = useCallback((date: Date): string[] => {
    const ds = startOfDay(date);
    const de = endOfDay(date);
    const dayEntries = entries.filter(e => {
      const s = new Date(e.start_time);
      return e.is_primary && s >= ds && s <= de;
    });
    const rootMap = new Map<string, string>();
    for (const e of dayEntries) {
      const root = getRootCategory(categories, e.category_id);
      if (root && !rootMap.has(root.id)) rootMap.set(root.id, root.name);
    }
    return Array.from(rootMap.values());
  }, [entries, categories]);

  // ─── Detail: 30-day data ────────────────────────────────────────────

  const detail30Data = useMemo(() => {
    if (!expandedHabit) return [];
    const habit = habits.find(h => h.id === expandedHabit);
    if (!habit || !habit.category_id) return [];
    const catIds = descendantMap.get(habit.category_id) || new Set([habit.category_id]);
    const result: { date: string; actual: number; target: number }[] = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = subDays(today, i);
      const ds = startOfDay(d);
      const de = endOfDay(d);
      const actual = detail30Entries.filter(e => {
        const s = new Date(e.start_time);
        return e.is_primary && catIds.has(e.category_id) && s >= ds && s <= de;
      }).reduce((sum, e) => sum + durationMinutes(e, ds, de), 0);
      result.push({
        date: format(d, 'MM/dd'),
        actual: Math.round(actual),
        target: habit.target_value,
      });
    }
    return result;
  }, [expandedHabit, habits, detail30Entries, descendantMap]);

  const detail30CompletionRate = useMemo(() => {
    if (!expandedHabit) return 0;
    const habit = habits.find(h => h.id === expandedHabit);
    if (!habit) return 0;
    let met = 0;
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = subDays(today, i);
      const dateStr = format(d, 'yyyy-MM-dd');
      const log = detail30Logs.find(l => l.habit_id === habit.id && l.date === dateStr);
      if (log) {
        if (log.is_met) met++;
      } else if (detail30Data.length > 0) {
        const idx = 29 - i;
        if (idx >= 0 && idx < detail30Data.length) {
          const actual = detail30Data[idx].actual;
          if (habit.type === 'time_max' ? actual <= habit.target_value : actual >= habit.target_value) met++;
        }
      }
    }
    return Math.round((met / 30) * 100);
  }, [expandedHabit, habits, detail30Logs, detail30Data]);

  const detailLongestStreak = useMemo(() => {
    if (detail30Data.length === 0 || !expandedHabit) return 0;
    const habit = habits.find(h => h.id === expandedHabit);
    if (!habit) return 0;
    let longest = 0;
    let current = 0;
    for (const d of detail30Data) {
      const met = habit.type === 'time_max' ? d.actual <= d.target : d.actual >= d.target;
      if (met) {
        current++;
        longest = Math.max(longest, current);
      } else {
        current = 0;
      }
    }
    return longest;
  }, [detail30Data, expandedHabit, habits]);

  const detail30Heatmap = useMemo(() => {
    if (detail30Data.length === 0 || !expandedHabit) return [];
    const habit = habits.find(h => h.id === expandedHabit);
    if (!habit) return [];
    return detail30Data.map(d => {
      const met = habit.type === 'time_max' ? d.actual <= d.target : d.actual >= d.target;
      return { met, ratio: Math.min(d.actual / (d.target || 1), 2) };
    });
  }, [detail30Data, expandedHabit, habits]);

  // ─── Expand handler ─────────────────────────────────────────────────

  const handleExpand = (habitId: string) => {
    if (expandedHabit === habitId) {
      setExpandedHabit(null);
    } else {
      setExpandedHabit(habitId);
      loadDetailData(habitId);
    }
  };

  // ─── Add habit ──────────────────────────────────────────────────────

  const handleAddHabit = async () => {
    if (!userId || !newName.trim()) return;
    await supabase.from('tf_habits').insert({
      user_id: userId,
      name: newName.trim(),
      type: newType,
      category_id: newCategoryId || null,
      target_value: parseFloat(newTarget) || 60,
      frequency: newFrequency,
    });
    setShowAddModal(false);
    setNewName('');
    setNewType('time_min');
    setNewCategoryId('');
    setNewTarget('60');
    setNewFrequency('daily');
    await loadHabits();
  };

  // ─── Upsert habit log ──────────────────────────────────────────────

  const upsertLog = useCallback(async (habit: Habit, date: Date) => {
    const actual = computeActual(habit, date);
    const met = habit.type === 'time_max' ? actual <= habit.target_value : actual >= habit.target_value;
    const dateStr = format(date, 'yyyy-MM-dd');
    await supabase.from('tf_habit_logs').upsert({
      habit_id: habit.id,
      date: dateStr,
      actual_value: actual,
      is_met: met,
    }, { onConflict: 'habit_id,date' });
  }, [computeActual]);

  useEffect(() => {
    if (habits.length === 0 || entries.length === 0) return;
    for (const h of habits) {
      if (h.frequency === 'daily') {
        upsertLog(h, selectedDate);
      }
    }
  }, [selectedDate, habits, entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Heatmap color ─────────────────────────────────────────────────

  const heatmapColor = (rate: number): string => {
    if (rate <= 0) return 'var(--bg-secondary)';
    if (rate < 0.25) return '#e0e7ff';
    if (rate < 0.5) return '#c7d2fe';
    if (rate < 0.75) return '#a5b4fc';
    if (rate < 1) return '#818cf8';
    return '#6366f1';
  };

  // ─── Progress bar color for time_max ────────────────────────────────

  const timeMaxColor = (ratio: number): string => {
    if (ratio <= 0.6) return '#22c55e';
    if (ratio <= 0.8) return '#eab308';
    if (ratio <= 1.0) return '#f97316';
    return '#ef4444';
  };

  // ─── Category color helper ─────────────────────────────────────────

  const getCatColor = (catId: string | null): string => {
    if (!catId) return '#6366f1';
    const cat = categories.find(c => c.id === catId);
    return cat?.color || '#6366f1';
  };

  // ─── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)] pb-20">
        加载中...
      </div>
    );
  }

  const weekDays = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <div className="flex-1 overflow-auto pb-24 px-4 pt-4">
      {/* ─── Month navigation ──────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCalMonth(m => subMonths(m, 1))}
          className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          ◀
        </button>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {format(calMonth, 'yyyy年M月')}
        </h2>
        <button
          onClick={() => setCalMonth(m => addMonths(m, 1))}
          className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          ▶
        </button>
      </div>

      {/* ─── Calendar heatmap ──────────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-1 mb-4">
        {weekDays.map(d => (
          <div key={d} className="text-center text-xs text-[var(--text-secondary)] font-medium py-1">{d}</div>
        ))}
        {calendarDays.map((day, i) => {
          if (!day) return <div key={`pad-${i}`} className="aspect-square" />;
          const rate = dayCompletionRate(day);
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, new Date());
          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelectedDate(day)}
              className="aspect-square rounded-md flex items-center justify-center text-xs font-medium relative transition-all"
              style={{
                backgroundColor: heatmapColor(rate),
                color: rate >= 0.75 ? '#fff' : rate > 0 ? '#4338ca' : 'var(--text-secondary)',
                outline: isSelected ? '2px solid #6366f1' : 'none',
                outlineOffset: '1px',
              }}
            >
              {day.getDate()}
              {rate >= 1 && (
                <span className="absolute -top-0.5 -right-0.5 text-[8px]">✓</span>
              )}
              {isToday && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-current" />
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Selected date ─────────────────────────────────────────── */}
      <div className="text-sm text-[var(--text-secondary)] mb-3 font-medium">
        {format(selectedDate, 'M月d日 EEEE', {})}
        {isSameDay(selectedDate, new Date()) && ' (今天)'}
      </div>

      {/* ─── Habit list ────────────────────────────────────────────── */}
      <div className="space-y-2">
        {habits.map(habit => {
          const actual = computeActual(habit, selectedDate);
          const met = isHabitMet(habit, selectedDate);
          const streak = computeStreak(habit);
          const catColor = getCatColor(habit.category_id);
          const isExpanded = expandedHabit === habit.id;

          // ─── Writing habit (weekly special) ───
          if (habit.frequency === 'weekly' && habit.name.includes('写小说')) {
            const wd = getWritingWeekData(habit, selectedDate);
            const daysMet = wd.daysWithEntry >= 3;
            const deepMet = wd.deepSessions >= 2;
            return (
              <div
                key={habit.id}
                className="bg-[var(--bg-card)] rounded-xl p-3 shadow-sm border border-[var(--border)]"
              >
                <button
                  onClick={() => handleExpand(habit.id)}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: catColor }} />
                    <span className="font-medium text-[var(--text-primary)] flex-1">{habit.name}</span>
                    {streak > 0 && (
                      <span className="text-xs text-orange-500">🔥{streak}</span>
                    )}
                  </div>
                  <div className="text-sm text-[var(--text-secondary)] space-y-1 ml-4">
                    <div>
                      本周: {wd.daysWithEntry}/3天 {daysMet ? '✓' : '✗'}
                    </div>
                    <div>
                      深度session: {wd.deepSessions}/2天 {deepMet ? '✓' : '✗'}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      今日: {Math.round(actual)}分钟
                    </div>
                  </div>
                </button>
                {isExpanded && renderDetail(habit)}
              </div>
            );
          }

          // ─── Task variety ───
          if (habit.type === 'task_variety') {
            const roots = getVarietyRoots(selectedDate);
            return (
              <div
                key={habit.id}
                className="bg-[var(--bg-card)] rounded-xl p-3 shadow-sm border border-[var(--border)]"
              >
                <button
                  onClick={() => handleExpand(habit.id)}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-indigo-500" />
                    <span className="font-medium text-[var(--text-primary)] flex-1">{habit.name}</span>
                    <span className={`text-sm font-medium ${met ? 'text-green-600' : 'text-[var(--text-secondary)]'}`}>
                      {met ? '✓' : '✗'}
                    </span>
                  </div>
                  <div className="text-sm text-[var(--text-secondary)] ml-4">
                    今日: {actual}种
                    {roots.length > 0 && (
                      <span className="text-[var(--text-secondary)] ml-2">
                        ({roots.join('、')})
                      </span>
                    )}
                  </div>
                </button>
                {isExpanded && renderDetail(habit)}
              </div>
            );
          }

          // ─── time_min / time_max ───
          const ratio = habit.target_value > 0 ? actual / habit.target_value : 0;
          const progressPercent = Math.min(ratio * 100, 100);
          let barColor: string;
          if (habit.type === 'time_max') {
            barColor = timeMaxColor(ratio);
          } else {
            barColor = met ? catColor : catColor + '66';
          }

          return (
            <div
              key={habit.id}
              className="bg-[var(--bg-card)] rounded-xl p-3 shadow-sm border border-[var(--border)]"
            >
              <button
                onClick={() => handleExpand(habit.id)}
                className="w-full text-left"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: catColor }} />
                  <span className="font-medium text-[var(--text-primary)] flex-1">{habit.name}</span>
                  <span className={`text-sm font-medium ${met ? 'text-green-600' : 'text-red-400'}`}>
                    {met ? '✓' : '✗'}
                  </span>
                  {streak > 0 && (
                    <span className="text-xs text-orange-500">🔥{streak}</span>
                  )}
                </div>
                {/* Progress bar */}
                <div className="flex items-center gap-2 ml-4">
                  <div className="flex-1 h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${progressPercent}%`,
                        backgroundColor: barColor,
                      }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap w-20 text-right">
                    {Math.round(actual)}/{habit.target_value}分钟
                  </span>
                </div>
                {habit.type === 'time_max' && (
                  <div className="text-xs text-[var(--text-secondary)] ml-4 mt-1">
                    ≤{habit.target_value}分钟
                  </div>
                )}
              </button>
              {isExpanded && renderDetail(habit)}
            </div>
          );
        })}
      </div>

      {/* ─── Add habit button ──────────────────────────────────────── */}
      <button
        onClick={() => setShowAddModal(true)}
        className="w-full mt-4 py-3 rounded-xl border-2 border-dashed border-[var(--border)] text-[var(--text-secondary)] hover:border-indigo-300 hover:text-indigo-500 transition-colors font-medium"
      >
        + 添加习惯
      </button>

      {/* ─── Add habit modal ───────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={() => setShowAddModal(false)}>
          <div
            className="bg-[var(--bg-card)] w-full max-w-md rounded-t-2xl p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">添加习惯</h3>

            <div>
              <label className="text-sm text-[var(--text-secondary)] block mb-1">习惯名称</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--bg-primary)] text-[var(--text-primary)]"
                placeholder="例如：学法语"
              />
            </div>

            <div>
              <label className="text-sm text-[var(--text-secondary)] block mb-1">类型</label>
              <div className="flex gap-2">
                {([['time_min', '≥ 时长'], ['time_max', '≤ 时长'], ['task_variety', '任务多样性']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setNewType(val)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      newType === val ? 'bg-indigo-500 text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {newType !== 'task_variety' && (
              <div>
                <label className="text-sm text-[var(--text-secondary)] block mb-1">关联分类</label>
                <select
                  value={newCategoryId}
                  onChange={e => setNewCategoryId(e.target.value)}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--bg-primary)] text-[var(--text-primary)]"
                >
                  <option value="">选择分类</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.parent_id ? '  └ ' : ''}{c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-sm text-[var(--text-secondary)] block mb-1">
                  {newType === 'task_variety' ? '目标种类数' : '目标分钟数'}
                </label>
                <input
                  value={newTarget}
                  onChange={e => setNewTarget(e.target.value)}
                  type="number"
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--bg-primary)] text-[var(--text-primary)]"
                />
              </div>
              <div className="flex-1">
                <label className="text-sm text-[var(--text-secondary)] block mb-1">频率</label>
                <div className="flex gap-2">
                  {([['daily', '每天'], ['weekly', '每周']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setNewFrequency(val)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        newFrequency === val ? 'bg-indigo-500 text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-[var(--bg-secondary)] text-[var(--text-secondary)] font-medium"
              >
                取消
              </button>
              <button
                onClick={handleAddHabit}
                className="flex-1 py-2.5 rounded-xl bg-indigo-500 text-white font-medium"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ─── Detail panel renderer ────────────────────────────────────────

  function renderDetail(habit: Habit) {
    const currentStreak = computeStreak(habit);
    const hasTimeData = (habit.type === 'time_min' || habit.type === 'time_max') && habit.category_id;

    return (
      <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-secondary)]">30天完成率</span>
          <span className="text-sm font-semibold text-indigo-600">{detail30CompletionRate}%</span>
        </div>

        {detail30Heatmap.length > 0 && (
          <div className="flex gap-0.5 flex-wrap">
            {detail30Heatmap.map((d, i) => (
              <div
                key={i}
                className="w-2.5 h-2.5 rounded-sm"
                style={{
                  backgroundColor: d.met ? '#6366f1' : d.ratio > 0 ? '#c7d2fe' : 'var(--bg-secondary)',
                }}
              />
            ))}
          </div>
        )}

        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-[var(--text-secondary)]">当前连续: </span>
            <span className="font-medium text-[var(--text-primary)]">{currentStreak}天</span>
          </div>
          <div>
            <span className="text-[var(--text-secondary)]">最长连续: </span>
            <span className="font-medium text-[var(--text-primary)]">{detailLongestStreak}天</span>
          </div>
        </div>

        {hasTimeData && detail30Data.length > 0 && (
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={detail30Data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  interval={6}
                />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={(v) => [`${v}分钟`, '实际']}
                />
                <ReferenceLine
                  y={habit.target_value}
                  stroke="#ef4444"
                  strokeDasharray="3 3"
                  label={{ value: '目标', fontSize: 10, fill: '#ef4444' }}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke={getCatColor(habit.category_id)}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  }
}
