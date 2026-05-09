import { useState, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { supabase, getUserId } from '../lib/supabase';
import { startOfDay, startOfWeek, startOfMonth } from 'date-fns';
import type { Category, TimeEntry } from '../lib/types';

type Range = 'today' | 'week' | 'month';

export default function Insights() {
  const [range, setRange] = useState<Range>('today');
  const [categories, setCategories] = useState<Category[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const userId = getUserId();

  const loadCategories = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_categories')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order');
    if (data) setCategories(data);
  }, [userId]);

  const loadEntries = useCallback(async () => {
    if (!userId) return;
    const now = new Date();
    let start: Date;
    if (range === 'today') {
      start = startOfDay(now);
    } else if (range === 'week') {
      start = startOfWeek(now, { weekStartsOn: 1 });
    } else {
      start = startOfMonth(now);
    }
    const { data } = await supabase
      .from('tf_time_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('start_time', start.toISOString())
      .not('end_time', 'is', null)
      .order('start_time');
    if (data) setEntries(data);
  }, [userId, range]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const getCategoryById = (id: string) => categories.find((c) => c.id === id);

  // Aggregate by top-level category
  const aggregated = () => {
    const catMap = new Map<string, number>();
    for (const entry of entries) {
      const cat = getCategoryById(entry.category_id);
      if (!cat) continue;
      const parentId = cat.parent_id ?? cat.id;
      const end = entry.end_time ? new Date(entry.end_time).getTime() : Date.now();
      const start = new Date(entry.start_time).getTime();
      const secs = Math.max(0, Math.floor((end - start) / 1000));
      catMap.set(parentId, (catMap.get(parentId) ?? 0) + secs);
    }
    return Array.from(catMap.entries())
      .map(([id, secs]) => {
        const cat = getCategoryById(id);
        return {
          id,
          name: cat?.name ?? '未知',
          color: cat?.color ?? '#6b7280',
          seconds: secs,
        };
      })
      .sort((a, b) => b.seconds - a.seconds);
  };

  const data = aggregated();
  const totalSeconds = data.reduce((a, b) => a + b.seconds, 0);
  const totalHours = (totalSeconds / 3600).toFixed(1);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ''}`;
    return `${m}m`;
  };

  const rangeLabels: Record<Range, string> = {
    today: '今天',
    week: '本周',
    month: '本月',
  };

  return (
    <div className="flex flex-col min-h-screen pb-16">
      <div className="bg-gray-800 text-white px-4 py-4">
        <h1 className="text-lg font-medium text-center">统计</h1>
      </div>

      {/* Range selector */}
      <div className="flex justify-center gap-2 px-4 py-3">
        {(Object.keys(rangeLabels) as Range[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
              range === r
                ? 'bg-gray-800 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {rangeLabels[r]}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          暂无数据
        </div>
      ) : (
        <>
          {/* Donut chart */}
          <div className="relative mx-auto" style={{ width: 240, height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={100}
                  dataKey="seconds"
                  stroke="none"
                >
                  {data.map((entry) => (
                    <Cell key={entry.id} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl font-semibold text-gray-800">
                  {totalHours}
                </div>
                <div className="text-xs text-gray-400">小时</div>
              </div>
            </div>
          </div>

          {/* Category list */}
          <div className="px-4 mt-4 space-y-2">
            {data.map((item) => {
              const pct =
                totalSeconds > 0
                  ? ((item.seconds / totalSeconds) * 100).toFixed(1)
                  : '0';
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 py-2 px-3 bg-white rounded-lg border border-gray-50"
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-sm text-gray-700 flex-1">{item.name}</span>
                  <span className="text-sm text-gray-500 tabular-nums">
                    {formatDuration(item.seconds)}
                  </span>
                  <span className="text-xs text-gray-400 w-12 text-right tabular-nums">
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
