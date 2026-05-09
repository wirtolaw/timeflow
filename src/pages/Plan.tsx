import { useState, useEffect, useCallback } from 'react';
import { supabase, getUserId } from '../lib/supabase';
import { format, addDays, subDays } from 'date-fns';
import type { Category, TimeEntry, DailyPlan, PlanBlock } from '../lib/types';

export default function Plan() {
  const userId = getUserId();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [categories, setCategories] = useState<Category[]>([]);
  const [rawText, setRawText] = useState('');
  const [planBlocks, setPlanBlocks] = useState<PlanBlock[]>([]);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [currentPlan, setCurrentPlan] = useState<DailyPlan | null>(null);

  const dateStr = format(selectedDate, 'yyyy-MM-dd');
  const displayDate = format(selectedDate, 'M月d日');
  const isToday = format(new Date(), 'yyyy-MM-dd') === dateStr;

  const loadCategories = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_categories')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order');
    if (data) setCategories(data);
  }, [userId]);

  const loadPlan = useCallback(async () => {
    if (!userId) return;
    const { data: plans } = await supabase
      .from('tf_daily_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('date', dateStr)
      .limit(1);
    if (plans && plans.length > 0) {
      const plan = plans[0] as DailyPlan;
      setCurrentPlan(plan);
      setRawText(plan.raw_text ?? '');
      const { data: blocks } = await supabase
        .from('tf_plan_blocks')
        .select('*')
        .eq('plan_id', plan.id)
        .order('start_time');
      if (blocks) setPlanBlocks(blocks as PlanBlock[]);
    } else {
      setCurrentPlan(null);
      setRawText('');
      setPlanBlocks([]);
    }
  }, [userId, dateStr]);

  const loadEntries = useCallback(async () => {
    if (!userId) return;
    const dayStart = `${dateStr}T00:00:00`;
    const dayEnd = `${dateStr}T23:59:59`;
    const { data } = await supabase
      .from('tf_time_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd)
      .not('end_time', 'is', null)
      .order('start_time');
    if (data) setTodayEntries(data);
  }, [userId, dateStr]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadPlan();
    loadEntries();
  }, [loadPlan, loadEntries]);

  const getCategoryById = (id: string) => categories.find((c) => c.id === id);

  const matchCategory = (taskName: string): string | null => {
    const lower = taskName.toLowerCase();
    for (const cat of categories) {
      if (lower.includes(cat.name.toLowerCase()) || cat.name.toLowerCase().includes(lower)) {
        return cat.id;
      }
    }
    return null;
  };

  const parseSchedule = (text: string): Array<{ start: string; end: string; task: string }> => {
    const results: Array<{ start: string; end: string; task: string }> = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(
        /(\d{1,2})[:：点]?(\d{2})?\s*[-~—–]\s*(\d{1,2})[:：点]?(\d{2})?\s+(.+)/
      );
      if (match) {
        const startH = match[1].padStart(2, '0');
        const startM = (match[2] ?? '00').padStart(2, '0');
        const endH = match[3].padStart(2, '0');
        const endM = (match[4] ?? '00').padStart(2, '0');
        results.push({
          start: `${startH}:${startM}`,
          end: `${endH}:${endM}`,
          task: match[5].trim(),
        });
      }
    }
    return results;
  };

  const handleParse = async () => {
    if (!userId || !rawText.trim()) return;
    const parsed = parseSchedule(rawText);
    if (parsed.length === 0) return;

    let planId: string;
    if (currentPlan) {
      await supabase
        .from('tf_daily_plans')
        .update({ raw_text: rawText })
        .eq('id', currentPlan.id);
      await supabase.from('tf_plan_blocks').delete().eq('plan_id', currentPlan.id);
      planId = currentPlan.id;
    } else {
      const { data } = await supabase
        .from('tf_daily_plans')
        .insert({
          user_id: userId,
          date: dateStr,
          raw_text: rawText,
        })
        .select()
        .single();
      if (!data) return;
      planId = data.id;
    }

    const blockRows = parsed.map((p) => {
      const matchedId = matchCategory(p.task);
      const startParts = p.start.split(':').map(Number);
      const endParts = p.end.split(':').map(Number);
      const estMins = (endParts[0] * 60 + endParts[1]) - (startParts[0] * 60 + startParts[1]);
      return {
        plan_id: planId,
        start_time: p.start + ':00',
        end_time: p.end + ':00',
        task_name: p.task,
        matched_category_id: matchedId,
        estimated_minutes: estMins > 0 ? estMins : null,
      };
    });

    await supabase.from('tf_plan_blocks').insert(blockRows);
    loadPlan();
  };

  const timeToMinutes = (t: string): number => {
    const parts = t.split(':').map(Number);
    return parts[0] * 60 + (parts[1] ?? 0);
  };

  const getTimeRange = (): { minMin: number; maxMin: number } => {
    let minMin = 24 * 60;
    let maxMin = 0;
    for (const block of planBlocks) {
      const s = timeToMinutes(block.start_time);
      const e = timeToMinutes(block.end_time);
      minMin = Math.min(minMin, s);
      maxMin = Math.max(maxMin, e);
    }
    for (const entry of todayEntries) {
      const s = new Date(entry.start_time);
      const e = entry.end_time ? new Date(entry.end_time) : new Date();
      const sMin = s.getHours() * 60 + s.getMinutes();
      const eMin = e.getHours() * 60 + e.getMinutes();
      minMin = Math.min(minMin, sMin);
      maxMin = Math.max(maxMin, eMin);
    }
    if (minMin >= maxMin) {
      minMin = 8 * 60;
      maxMin = 22 * 60;
    }
    minMin = Math.floor(minMin / 60) * 60;
    maxMin = Math.ceil(maxMin / 60) * 60;
    return { minMin, maxMin };
  };

  const { minMin, maxMin } = getTimeRange();
  const totalRange = maxMin - minMin || 1;
  const TIMELINE_HEIGHT = 500;

  const getBlockStyle = (startMin: number, endMin: number) => {
    const top = ((startMin - minMin) / totalRange) * TIMELINE_HEIGHT;
    const height = Math.max(((endMin - startMin) / totalRange) * TIMELINE_HEIGHT, 20);
    return { top, height };
  };

  const actualBlocks = todayEntries.map((entry) => {
    const s = new Date(entry.start_time);
    const e = entry.end_time ? new Date(entry.end_time) : new Date();
    const sMin = s.getHours() * 60 + s.getMinutes();
    const eMin = e.getHours() * 60 + e.getMinutes();
    const cat = getCategoryById(entry.category_id);
    const parent = cat?.parent_id ? getCategoryById(cat.parent_id) : cat;
    return {
      startMin: sMin,
      endMin: eMin,
      name: cat ? (parent && parent.id !== cat.id ? `${parent.name}·${cat.name}` : cat.name) : '未知',
      color: cat?.color ?? parent?.color ?? '#6b7280',
      categoryId: entry.category_id,
      minutes: Math.round(eMin - sMin),
    };
  });

  const computeMatchStats = () => {
    if (planBlocks.length === 0 || actualBlocks.length === 0) return null;

    let matchedMinutes = 0;
    let totalPlannedMinutes = 0;
    const matchedSlots: Array<{ task: string; time: string; color: string }> = [];
    const deviatedSlots: Array<{ task: string; time: string; color: string }> = [];

    for (const block of planBlocks) {
      const planned = block.estimated_minutes ?? 0;
      totalPlannedMinutes += planned;
      const blockStart = timeToMinutes(block.start_time);
      const blockEnd = timeToMinutes(block.end_time);
      const windowStart = blockStart - 30;
      const windowEnd = blockEnd + 30;

      let found = false;
      for (const ab of actualBlocks) {
        if (!block.matched_category_id) continue;
        if (ab.endMin <= windowStart || ab.startMin >= windowEnd) continue;

        const matchedCat = getCategoryById(block.matched_category_id);
        const abCat = getCategoryById(ab.categoryId);
        if (!matchedCat || !abCat) continue;

        const matchParentId = matchedCat.parent_id ?? matchedCat.id;
        const abParentId = abCat.parent_id ?? abCat.id;

        if (ab.categoryId === block.matched_category_id || abParentId === matchParentId) {
          const overlapStart = Math.max(ab.startMin, blockStart);
          const overlapEnd = Math.min(ab.endMin, blockEnd);
          const overlap = Math.max(0, overlapEnd - overlapStart);
          matchedMinutes += overlap;
          found = true;
        }
      }

      const cat = block.matched_category_id ? getCategoryById(block.matched_category_id) : null;
      const parent = cat?.parent_id ? getCategoryById(cat.parent_id) : cat;
      const color = parent?.color ?? cat?.color ?? '#6b7280';
      const timeStr = `${block.start_time.slice(0, 5)}-${block.end_time.slice(0, 5)}`;

      if (found) {
        matchedSlots.push({ task: block.task_name, time: timeStr, color });
      } else {
        deviatedSlots.push({ task: block.task_name, time: timeStr, color });
      }
    }

    const matchRate = totalPlannedMinutes > 0 ? Math.round((matchedMinutes / totalPlannedMinutes) * 100) : 0;
    return { matchRate, matchedMinutes, totalPlannedMinutes, matchedSlots, deviatedSlots };
  };

  const computeAccuracyStats = () => {
    if (planBlocks.length === 0 || actualBlocks.length === 0) return null;

    const rows: Array<{
      task: string;
      planned: number;
      actual: number;
      deviationPct: number;
      color: string;
    }> = [];

    for (const block of planBlocks) {
      const planned = block.estimated_minutes ?? 0;
      if (planned <= 0) continue;

      let actualMins = 0;
      for (const ab of actualBlocks) {
        if (!block.matched_category_id) continue;
        const matchedCat = getCategoryById(block.matched_category_id);
        const abCat = getCategoryById(ab.categoryId);
        if (!matchedCat || !abCat) continue;
        const matchParentId = matchedCat.parent_id ?? matchedCat.id;
        const abParentId = abCat.parent_id ?? abCat.id;
        if (ab.categoryId === block.matched_category_id || abParentId === matchParentId) {
          const blockStart = timeToMinutes(block.start_time);
          const blockEnd = timeToMinutes(block.end_time);
          const overlapStart = Math.max(ab.startMin, blockStart - 30);
          const overlapEnd = Math.min(ab.endMin, blockEnd + 30);
          if (overlapEnd > overlapStart) {
            actualMins += overlapEnd - overlapStart;
          }
        }
      }

      const deviationPct = planned > 0 ? Math.round(((actualMins - planned) / planned) * 100) : 0;
      const cat = block.matched_category_id ? getCategoryById(block.matched_category_id) : null;
      const parent = cat?.parent_id ? getCategoryById(cat.parent_id) : cat;
      rows.push({
        task: block.task_name,
        planned,
        actual: actualMins,
        deviationPct,
        color: parent?.color ?? cat?.color ?? '#6b7280',
      });
    }

    const avgAbsDev = rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + Math.abs(r.deviationPct), 0) / rows.length)
      : 0;

    return { rows, avgAbsDev };
  };

  const matchStats = computeMatchStats();
  const accuracyStats = computeAccuracyStats();

  const getDeviationColor = (pct: number) => {
    const abs = Math.abs(pct);
    if (abs <= 10) return 'text-green-600';
    if (abs <= 30) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getDeviationDot = (pct: number) => {
    const abs = Math.abs(pct);
    if (abs <= 10) return '\u{1F7E2}';
    if (abs <= 30) return '\u{1F7E1}';
    return '\u{1F534}';
  };

  const timeLabels: number[] = [];
  for (let m = minMin; m <= maxMin; m += 60) {
    timeLabels.push(m);
  }

  return (
    <div className="flex flex-col min-h-screen pb-16">
      {/* Header */}
      <div className="bg-gray-800 text-white px-4 py-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedDate(subDays(selectedDate, 1))}
            className="px-3 py-1 text-lg"
          >
            ‹
          </button>
          <div className="text-center">
            <div className="text-base font-medium">{displayDate}</div>
            {isToday && <div className="text-xs text-gray-400">今天</div>}
          </div>
          <button
            onClick={() => setSelectedDate(addDays(selectedDate, 1))}
            className="px-3 py-1 text-lg"
          >
            ›
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* Plan input area */}
        <div className="mb-4">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={"粘贴日程文字，例如:\n9:00-10:30 学法语课程\n14:00-15:00 写小说\n15:30-17:00 投简历"}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 resize-none bg-[var(--bg-card)] text-[var(--text-primary)]"
            rows={4}
          />
          <button
            onClick={handleParse}
            disabled={!rawText.trim()}
            className="mt-2 w-full py-2 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-40"
          >
            解析日程
          </button>
        </div>

        {/* Timeline comparison */}
        {(planBlocks.length > 0 || actualBlocks.length > 0) && (
          <div className="mb-4">
            <div className="flex text-xs text-[var(--text-secondary)] mb-2">
              <div className="w-10" />
              <div className="flex-1 text-center font-medium">计划</div>
              <div className="flex-1 text-center font-medium">实际</div>
            </div>

            <div className="flex relative" style={{ height: TIMELINE_HEIGHT }}>
              {/* Time axis */}
              <div className="w-10 relative shrink-0">
                {timeLabels.map((m) => {
                  const top = ((m - minMin) / totalRange) * TIMELINE_HEIGHT;
                  const h = Math.floor(m / 60);
                  return (
                    <div
                      key={m}
                      className="absolute text-xs text-[var(--text-secondary)] -translate-y-1/2"
                      style={{ top }}
                    >
                      {h}:00
                    </div>
                  );
                })}
              </div>

              {/* Plan column */}
              <div className="flex-1 relative mx-1">
                {timeLabels.map((m) => {
                  const top = ((m - minMin) / totalRange) * TIMELINE_HEIGHT;
                  return (
                    <div
                      key={m}
                      className="absolute w-full border-t border-[var(--border)]"
                      style={{ top }}
                    />
                  );
                })}
                {planBlocks.map((block) => {
                  const sMin = timeToMinutes(block.start_time);
                  const eMin = timeToMinutes(block.end_time);
                  const { top, height } = getBlockStyle(sMin, eMin);
                  const cat = block.matched_category_id
                    ? getCategoryById(block.matched_category_id)
                    : null;
                  const parent = cat?.parent_id ? getCategoryById(cat.parent_id) : cat;
                  const color = parent?.color ?? cat?.color ?? '#9ca3af';
                  return (
                    <div
                      key={block.id}
                      className="absolute left-0 right-0 rounded-md px-1.5 py-1 overflow-hidden"
                      style={{
                        top,
                        height,
                        backgroundColor: color + '20',
                        borderLeft: `3px solid ${color}`,
                      }}
                    >
                      <div className="text-xs font-medium truncate" style={{ color }}>
                        {block.task_name}
                      </div>
                      {height > 30 && (
                        <div className="text-xs text-[var(--text-secondary)]">
                          {block.estimated_minutes}分钟
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Actual column */}
              <div className="flex-1 relative mx-1">
                {timeLabels.map((m) => {
                  const top = ((m - minMin) / totalRange) * TIMELINE_HEIGHT;
                  return (
                    <div
                      key={m}
                      className="absolute w-full border-t border-[var(--border)]"
                      style={{ top }}
                    />
                  );
                })}
                {actualBlocks.map((ab, i) => {
                  const { top, height } = getBlockStyle(ab.startMin, ab.endMin);
                  return (
                    <div
                      key={i}
                      className="absolute left-0 right-0 rounded-md px-1.5 py-1 overflow-hidden"
                      style={{
                        top,
                        height,
                        backgroundColor: ab.color + '30',
                        borderLeft: `3px solid ${ab.color}`,
                      }}
                    >
                      <div className="text-xs font-medium truncate" style={{ color: ab.color }}>
                        {ab.name}
                      </div>
                      {height > 30 && (
                        <div className="text-xs text-[var(--text-secondary)]">{ab.minutes}分钟</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Bottom Stats Cards */}
        {(matchStats || accuracyStats) && (
          <div className="space-y-4 mb-4">
            {/* Card 1: 执行匹配度 */}
            {matchStats && (
              <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)]">
                <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">执行匹配度</h3>
                <div className="text-center mb-3">
                  <div className="text-3xl font-bold text-[var(--text-primary)]">{matchStats.matchRate}%</div>
                  <div className="text-xs text-[var(--text-secondary)] mt-1">
                    匹配 {matchStats.matchedMinutes} 分钟 / 计划 {matchStats.totalPlannedMinutes} 分钟
                  </div>
                </div>
                <div className="w-full h-2.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${matchStats.matchRate}%`,
                      backgroundColor: matchStats.matchRate >= 70 ? '#22c55e' : matchStats.matchRate >= 40 ? '#eab308' : '#ef4444',
                    }}
                  />
                </div>

                {matchStats.matchedSlots.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-medium text-green-600 mb-1.5">已匹配时段</div>
                    <div className="space-y-1">
                      {matchStats.matchedSlots.map((slot, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: slot.color }} />
                          <span className="text-[var(--text-secondary)] tabular-nums w-24 shrink-0">{slot.time}</span>
                          <span className="text-[var(--text-primary)] truncate">{slot.task}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {matchStats.deviatedSlots.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-red-500 mb-1.5">未匹配时段</div>
                    <div className="space-y-1">
                      {matchStats.deviatedSlots.map((slot, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: slot.color }} />
                          <span className="text-[var(--text-secondary)] tabular-nums w-24 shrink-0">{slot.time}</span>
                          <span className="text-[var(--text-primary)] truncate">{slot.task}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Card 2: 时间估计准确度 */}
            {accuracyStats && accuracyStats.rows.length > 0 && (
              <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)]">
                <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">时间估计准确度</h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th className="text-left py-1.5 text-[var(--text-secondary)] font-medium">任务</th>
                        <th className="text-right py-1.5 text-[var(--text-secondary)] font-medium w-16">计划</th>
                        <th className="text-right py-1.5 text-[var(--text-secondary)] font-medium w-16">实际</th>
                        <th className="text-right py-1.5 text-[var(--text-secondary)] font-medium w-16">偏差</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accuracyStats.rows.map((row, i) => (
                        <tr key={i} className="border-b border-[var(--border)]">
                          <td className="py-1.5 truncate max-w-[120px]" style={{ color: row.color }}>
                            {row.task}
                          </td>
                          <td className="text-right py-1.5 text-[var(--text-secondary)] tabular-nums">{row.planned}m</td>
                          <td className="text-right py-1.5 text-[var(--text-primary)] tabular-nums">{row.actual}m</td>
                          <td className={`text-right py-1.5 tabular-nums ${getDeviationColor(row.deviationPct)}`}>
                            {getDeviationDot(row.deviationPct)} {row.deviationPct > 0 ? '+' : ''}{row.deviationPct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 pt-3 border-t border-[var(--border)] flex justify-between items-center">
                  <span className="text-xs text-[var(--text-secondary)]">平均绝对偏差</span>
                  <span className={`text-sm font-semibold ${getDeviationColor(accuracyStats.avgAbsDev)}`}>
                    {accuracyStats.avgAbsDev}%
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {planBlocks.length === 0 && actualBlocks.length === 0 && (
          <div className="text-center text-[var(--text-secondary)] text-sm py-8">
            粘贴日程文字并点击"解析日程"开始
          </div>
        )}
      </div>
    </div>
  );
}
