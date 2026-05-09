import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { supabase, getUserId } from '../lib/supabase';
import {
  startOfDay, startOfWeek, startOfMonth,
  format, subDays, eachDayOfInterval, startOfISOWeek, endOfISOWeek,
  eachWeekOfInterval, eachMonthOfInterval, endOfMonth,
} from 'date-fns';
import type { Category, TimeEntry, Project } from '../lib/types';

type Range = 'today' | 'week' | 'month';
type SubTab = 'distribution' | 'trends' | 'projects';
type Granularity = 'day' | 'week' | 'month';
type ProjectStatus = 'active' | 'completed' | 'archived';

export default function Insights() {
  const [range, setRange] = useState<Range>('today');
  const [subTab, setSubTab] = useState<SubTab>('distribution');
  const [categories, setCategories] = useState<Category[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [allEntries, setAllEntries] = useState<TimeEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectEntries, setProjectEntries] = useState<TimeEntry[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>('active');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
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

  const loadAllEntries = useCallback(async () => {
    if (!userId) return;
    const start = subDays(new Date(), 90);
    const { data } = await supabase
      .from('tf_time_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('start_time', start.toISOString())
      .not('end_time', 'is', null)
      .order('start_time');
    if (data) setAllEntries(data);
  }, [userId]);

  const loadProjects = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_projects')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (data) setProjects(data);
  }, [userId]);

  const loadProjectEntries = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_time_entries')
      .select('*')
      .eq('user_id', userId)
      .not('project_id', 'is', null)
      .not('end_time', 'is', null)
      .order('start_time');
    if (data) setProjectEntries(data);
  }, [userId]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (subTab === 'trends') loadAllEntries();
  }, [subTab, loadAllEntries]);

  useEffect(() => {
    if (subTab === 'projects') {
      loadProjects();
      loadProjectEntries();
    }
  }, [subTab, loadProjects, loadProjectEntries]);

  const getCategoryById = (id: string) => categories.find((c) => c.id === id);

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

  const todayTimeline = useMemo(() => {
    const todayEntries = entries.filter(() => range === 'today');
    if (range !== 'today') return [];
    return todayEntries.map((entry) => {
      const s = new Date(entry.start_time);
      const e = entry.end_time ? new Date(entry.end_time) : new Date();
      const cat = getCategoryById(entry.category_id);
      const parent = cat?.parent_id ? getCategoryById(cat.parent_id) : cat;
      return {
        startHour: s.getHours() + s.getMinutes() / 60,
        endHour: e.getHours() + e.getMinutes() / 60,
        color: cat?.color ?? parent?.color ?? '#6b7280',
        name: cat?.name ?? '未知',
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, range, categories]);

  const parentCategories = useMemo(
    () => categories.filter((c) => !c.parent_id),
    [categories]
  );

  useEffect(() => {
    if (subTab === 'trends' && selectedCategoryIds.length === 0 && allEntries.length > 0 && parentCategories.length > 0) {
      const catTime = new Map<string, number>();
      for (const entry of allEntries) {
        const cat = getCategoryById(entry.category_id);
        if (!cat) continue;
        const parentId = cat.parent_id ?? cat.id;
        const dur = entry.end_time
          ? (new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 1000
          : 0;
        catTime.set(parentId, (catTime.get(parentId) ?? 0) + dur);
      }
      const sorted = Array.from(catTime.entries()).sort((a, b) => b[1] - a[1]);
      setSelectedCategoryIds(sorted.slice(0, 3).map(([id]) => id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, allEntries, parentCategories]);

  const toggleCategory = (id: string) => {
    setSelectedCategoryIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  };

  const trendData = useMemo(() => {
    if (allEntries.length === 0 || selectedCategoryIds.length === 0) return [];

    const now = new Date();
    const start = subDays(now, 90);
    let intervals: { label: string; start: Date; end: Date }[] = [];

    if (granularity === 'day') {
      const days = eachDayOfInterval({ start: subDays(now, 30), end: now });
      intervals = days.map((d) => ({
        label: format(d, 'M/d'),
        start: startOfDay(d),
        end: new Date(startOfDay(d).getTime() + 86400000),
      }));
    } else if (granularity === 'week') {
      const weeks = eachWeekOfInterval({ start, end: now }, { weekStartsOn: 1 });
      intervals = weeks.map((w) => ({
        label: format(startOfISOWeek(w), 'M/d'),
        start: startOfISOWeek(w),
        end: new Date(endOfISOWeek(w).getTime() + 1),
      }));
    } else {
      const months = eachMonthOfInterval({ start, end: now });
      intervals = months.map((m) => ({
        label: format(m, 'M月'),
        start: startOfMonth(m),
        end: new Date(endOfMonth(m).getTime() + 1),
      }));
    }

    return intervals.map((iv) => {
      const point: Record<string, string | number> = { label: iv.label };
      for (const catId of selectedCategoryIds) {
        let totalSecs = 0;
        for (const entry of allEntries) {
          const entryStart = new Date(entry.start_time);
          const entryEnd = entry.end_time ? new Date(entry.end_time) : new Date();
          if (entryStart >= iv.end || entryEnd <= iv.start) continue;
          const cat = getCategoryById(entry.category_id);
          if (!cat) continue;
          const parentId = cat.parent_id ?? cat.id;
          if (parentId === catId) {
            totalSecs += (Math.min(entryEnd.getTime(), iv.end.getTime()) - Math.max(entryStart.getTime(), iv.start.getTime())) / 1000;
          }
        }
        point[catId] = Math.round((totalSecs / 3600) * 10) / 10;
      }
      return point;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries, selectedCategoryIds, granularity, categories]);

  const filteredProjects = useMemo(
    () => projects.filter((p) => p.status === projectStatus),
    [projects, projectStatus]
  );

  const getProjectHours = (projectId: string) => {
    let total = 0;
    for (const e of projectEntries) {
      if (e.project_id !== projectId) continue;
      const dur = e.end_time
        ? (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 1000
        : 0;
      total += dur;
    }
    return Math.round((total / 3600) * 10) / 10;
  };

  const getProjectSubCategoryBreakdown = (projectId: string) => {
    const catMap = new Map<string, number>();
    for (const e of projectEntries) {
      if (e.project_id !== projectId) continue;
      const dur = e.end_time
        ? (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 1000
        : 0;
      catMap.set(e.category_id, (catMap.get(e.category_id) ?? 0) + dur);
    }
    return Array.from(catMap.entries()).map(([catId, secs]) => {
      const cat = getCategoryById(catId);
      return {
        id: catId,
        name: cat?.name ?? '未知',
        color: cat?.color ?? '#6b7280',
        seconds: secs,
        hours: Math.round((secs / 3600) * 10) / 10,
      };
    }).sort((a, b) => b.seconds - a.seconds);
  };

  const getProjectTrendData = (projectId: string) => {
    const relevantEntries = projectEntries.filter((e) => e.project_id === projectId);
    if (relevantEntries.length === 0) return [];
    const now = new Date();
    const days = eachDayOfInterval({ start: subDays(now, 30), end: now });
    return days.map((d) => {
      const dayStart = startOfDay(d);
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      let totalSecs = 0;
      for (const e of relevantEntries) {
        const es = new Date(e.start_time);
        const ee = e.end_time ? new Date(e.end_time) : new Date();
        if (es >= dayEnd || ee <= dayStart) continue;
        totalSecs += (Math.min(ee.getTime(), dayEnd.getTime()) - Math.max(es.getTime(), dayStart.getTime())) / 1000;
      }
      return {
        label: format(d, 'M/d'),
        hours: Math.round((totalSecs / 3600) * 10) / 10,
      };
    });
  };

  const subTabLabels: Record<SubTab, string> = {
    distribution: '分布',
    trends: '趋势',
    projects: '项目',
  };

  const granularityLabels: Record<Granularity, string> = {
    day: '日',
    week: '周',
    month: '月',
  };

  const statusLabels: Record<ProjectStatus, string> = {
    active: 'Active',
    completed: 'Completed',
    archived: 'Archived',
  };

  return (
    <div className="flex flex-col min-h-screen pb-16">
      <div className="bg-gray-800 text-white px-4 py-4">
        <h1 className="text-lg font-medium text-center">统计</h1>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-[var(--border)] bg-[var(--bg-card)]">
        {(Object.keys(subTabLabels) as SubTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
              subTab === tab
                ? 'text-[var(--text-primary)] border-b-2 border-gray-800 dark:border-gray-200'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {subTabLabels[tab]}
          </button>
        ))}
      </div>

      {/* ====== Sub-tab: 分布 ====== */}
      {subTab === 'distribution' && (
        <div className="flex-1 overflow-y-auto">
          {/* Range selector */}
          <div className="flex justify-center gap-2 px-4 py-3">
            {(Object.keys(rangeLabels) as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                  range === r
                    ? 'bg-gray-800 text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:opacity-80'
                }`}
              >
                {rangeLabels[r]}
              </button>
            ))}
          </div>

          {data.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)] py-20">
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
                    <div className="text-2xl font-semibold text-[var(--text-primary)]">
                      {totalHours}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">小时</div>
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
                      className="flex items-center gap-3 py-2 px-3 bg-[var(--bg-card)] rounded-lg border border-[var(--border)]"
                    >
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-sm text-[var(--text-primary)] flex-1">{item.name}</span>
                      <span className="text-sm text-[var(--text-secondary)] tabular-nums">
                        {formatDuration(item.seconds)}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)] w-12 text-right tabular-nums">
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Daily timeline (only for "today") */}
              {range === 'today' && todayTimeline.length > 0 && (
                <div className="px-4 mt-6 mb-4">
                  <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">今日时间线</h3>
                  <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-3">
                    <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
                      {[0, 6, 12, 18, 24].map((h) => (
                        <span key={h}>{h}</span>
                      ))}
                    </div>
                    <div className="relative h-6 bg-[var(--bg-secondary)] rounded overflow-hidden">
                      {todayTimeline.map((block, i) => {
                        const left = (block.startHour / 24) * 100;
                        const width = Math.max(((block.endHour - block.startHour) / 24) * 100, 0.5);
                        return (
                          <div
                            key={i}
                            className="absolute top-0 bottom-0 rounded-sm"
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              backgroundColor: block.color,
                              opacity: 0.8,
                            }}
                            title={`${block.name} ${Math.floor(block.startHour)}:${String(Math.round((block.startHour % 1) * 60)).padStart(2, '0')}-${Math.floor(block.endHour)}:${String(Math.round((block.endHour % 1) * 60)).padStart(2, '0')}`}
                          />
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                      {Array.from(new Set(todayTimeline.map((t) => t.name))).map((name) => {
                        const block = todayTimeline.find((t) => t.name === name);
                        return (
                          <div key={name} className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: block?.color }} />
                            {name}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ====== Sub-tab: 趋势 ====== */}
      {subTab === 'trends' && (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-3">
            <div className="text-xs text-[var(--text-secondary)] mb-1.5">选择分类（最多5个）</div>
            <div className="flex flex-wrap gap-2">
              {parentCategories.map((cat) => {
                const isSelected = selectedCategoryIds.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    onClick={() => toggleCategory(cat.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors border ${
                      isSelected
                        ? 'border-transparent text-white'
                        : 'border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-card)]'
                    }`}
                    style={isSelected ? { backgroundColor: cat.color } : undefined}
                  >
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: isSelected ? '#fff' : cat.color }}
                    />
                    {cat.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-center gap-1 mb-4">
            {(Object.keys(granularityLabels) as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  granularity === g
                    ? 'bg-gray-800 text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                }`}
              >
                {granularityLabels[g]}
              </button>
            ))}
          </div>

          {trendData.length > 0 && selectedCategoryIds.length > 0 ? (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                    label={{ value: '小时', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'var(--text-secondary)' } }}
                    width={35}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                    formatter={((value: unknown, name: unknown) => {
                      const catId = String(name ?? '');
                      const cat = getCategoryById(catId);
                      return [`${value}h`, cat?.name ?? catId];
                    }) as never}
                  />
                  {selectedCategoryIds.map((catId) => {
                    const cat = getCategoryById(catId);
                    return (
                      <Line
                        key={catId}
                        type="monotone"
                        dataKey={catId}
                        stroke={cat?.color ?? '#6b7280'}
                        strokeWidth={2}
                        dot={false}
                        name={catId}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center text-[var(--text-secondary)] text-sm py-16">
              {selectedCategoryIds.length === 0 ? '请选择至少一个分类' : '暂无数据'}
            </div>
          )}
        </div>
      )}

      {/* ====== Sub-tab: 项目 ====== */}
      {subTab === 'projects' && (
        <div className="flex-1 overflow-y-auto">
          {selectedProject ? (
            <div className="px-4 py-3">
              <button
                onClick={() => setSelectedProject(null)}
                className="text-sm text-[var(--text-secondary)] mb-3 flex items-center gap-1"
              >
                ← 返回
              </button>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{selectedProject.name}</h2>
              {(() => {
                const cat = getCategoryById(selectedProject.category_id);
                return cat ? (
                  <span
                    className="inline-block text-xs px-2 py-0.5 rounded-full text-white mb-4"
                    style={{ backgroundColor: cat.color }}
                  >
                    {cat.name}
                  </span>
                ) : null;
              })()}

              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3 mb-4">
                <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">时间趋势（近30天）</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={getProjectTrendData(selectedProject.id)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} width={30} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                    <Line type="monotone" dataKey="hours" stroke="#6366f1" strokeWidth={2} dot={false} name="小时" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3">
                <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">分类时间明细</h3>
                {(() => {
                  const breakdown = getProjectSubCategoryBreakdown(selectedProject.id);
                  if (breakdown.length === 0) return <div className="text-sm text-[var(--text-secondary)]">暂无数据</div>;
                  return (
                    <div className="space-y-2">
                      {breakdown.map((item) => (
                        <div key={item.id} className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                          <span className="text-sm text-[var(--text-primary)] flex-1">{item.name}</span>
                          <span className="text-sm text-[var(--text-secondary)] tabular-nums">{item.hours}h</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <>
              <div className="flex border-b border-[var(--border)] bg-[var(--bg-card)]">
                {(Object.keys(statusLabels) as ProjectStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setProjectStatus(s)}
                    className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
                      projectStatus === s
                        ? 'text-[var(--text-primary)] border-b-2 border-gray-800 dark:border-gray-200'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {statusLabels[s]}
                  </button>
                ))}
              </div>

              <div className="px-4 py-3 space-y-3">
                {filteredProjects.length === 0 ? (
                  <div className="text-center text-[var(--text-secondary)] text-sm py-16">暂无项目</div>
                ) : (
                  filteredProjects.map((project) => {
                    const cat = getCategoryById(project.category_id);
                    const hours = getProjectHours(project.id);
                    const breakdown = getProjectSubCategoryBreakdown(project.id);
                    const totalBreakdownSecs = breakdown.reduce((s, b) => s + b.seconds, 0);

                    return (
                      <button
                        key={project.id}
                        onClick={() => setSelectedProject(project)}
                        className="w-full text-left bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 active:opacity-80 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[var(--text-primary)] text-sm">{project.name}</div>
                            {cat && (
                              <span
                                className="inline-block text-xs px-2 py-0.5 rounded-full text-white mt-1"
                                style={{ backgroundColor: cat.color }}
                              >
                                {cat.name}
                              </span>
                            )}
                            <div className="text-xs text-[var(--text-secondary)] mt-1">总计 {hours} 小时</div>
                          </div>

                          {breakdown.length > 0 && (
                            <div style={{ width: 48, height: 48 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={breakdown}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={10}
                                    outerRadius={22}
                                    dataKey="seconds"
                                    stroke="none"
                                  >
                                    {breakdown.map((b) => (
                                      <Cell key={b.id} fill={b.color} />
                                    ))}
                                  </Pie>
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </div>

                        {breakdown.length > 0 && totalBreakdownSecs > 0 && (
                          <div className="mt-2 flex rounded-full overflow-hidden h-1.5">
                            {breakdown.map((b) => (
                              <div
                                key={b.id}
                                style={{
                                  width: `${(b.seconds / totalBreakdownSecs) * 100}%`,
                                  backgroundColor: b.color,
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
