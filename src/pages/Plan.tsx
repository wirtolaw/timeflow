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

  // New state for layout
  const [isEditingPlan, setIsEditingPlan] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showPasteSection, setShowPasteSection] = useState(false);

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

  // Reset editing state when date changes
  useEffect(() => {
    setIsEditingPlan(false);
    setShowPasteSection(false);
    setShowReport(false);
  }, [dateStr]);

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
    setIsEditingPlan(false);
    loadPlan();
  };

  const timeToMinutes = (t: string): number => {
    const parts = t.split(':').map(Number);
    return parts[0] * 60 + (parts[1] ?? 0);
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
      entry,
    };
  });

  // Match status for each plan block: check if actual entries overlap + category match
  const getPlanBlockMatchStatus = (block: PlanBlock): 'matched' | 'deviated' | 'none' => {
    if (actualBlocks.length === 0) return 'none';

    const blockStart = timeToMinutes(block.start_time);
    const blockEnd = timeToMinutes(block.end_time);
    const windowStart = blockStart - 30;
    const windowEnd = blockEnd + 30;

    for (const ab of actualBlocks) {
      if (!block.matched_category_id) continue;
      if (ab.endMin <= windowStart || ab.startMin >= windowEnd) continue;

      const matchedCat = getCategoryById(block.matched_category_id);
      const abCat = getCategoryById(ab.categoryId);
      if (!matchedCat || !abCat) continue;

      const matchParentId = matchedCat.parent_id ?? matchedCat.id;
      const abParentId = abCat.parent_id ?? abCat.id;

      if (ab.categoryId === block.matched_category_id || abParentId === matchParentId) {
        return 'matched';
      }
    }

    // There are actual entries but none matched this plan block
    return 'deviated';
  };

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

  // ====== Time Record Paste Feature ======
  const [recordDate, setRecordDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [recordText, setRecordText] = useState('');
  const [recordPreview, setRecordPreview] = useState<Array<{
    start: string;
    end: string;
    description: string;
    categoryId: string | null;
    categoryPath: string | null;
    originalText: string;
  }>>([]);
  const [showRecordPreview, setShowRecordPreview] = useState(false);
  const [recordOverlapWarning, setRecordOverlapWarning] = useState('');
  const [recordInserting, setRecordInserting] = useState(false);

  // Get all leaf categories (no children)
  const getLeafCategories = useCallback(() => {
    return categories.filter(c => !categories.some(child => child.parent_id === c.id));
  }, [categories]);

  // Build category path string
  const buildCategoryPath = useCallback((catId: string): string => {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return '';
    if (cat.parent_id) {
      const parent = categories.find(c => c.id === cat.parent_id);
      if (parent) {
        if (parent.parent_id) {
          const grandparent = categories.find(c => c.id === parent.parent_id);
          if (grandparent) return `${grandparent.name} > ${parent.name} > ${cat.name}`;
        }
        return `${parent.name} > ${cat.name}`;
      }
    }
    return cat.name;
  }, [categories]);

  // Fuzzy match description against leaf categories
  const fuzzyMatchCategory = useCallback((description: string): { id: string; path: string } | null => {
    const leaves = getLeafCategories();
    const desc = description.toLowerCase().trim();

    // First pass: exact substring match
    for (const leaf of leaves) {
      const leafName = leaf.name.toLowerCase();
      if (desc.includes(leafName) || leafName.includes(desc)) {
        return { id: leaf.id, path: buildCategoryPath(leaf.id) };
      }
    }

    // Second pass: keyword match
    const keywords = desc.split(/[\s,，、]+/).filter(k => k.length >= 2);
    for (const leaf of leaves) {
      const leafName = leaf.name.toLowerCase();
      for (const kw of keywords) {
        if (leafName.includes(kw) || kw.includes(leafName)) {
          return { id: leaf.id, path: buildCategoryPath(leaf.id) };
        }
      }
    }

    // Third pass: parent category names
    for (const leaf of leaves) {
      const parent = leaf.parent_id ? categories.find(c => c.id === leaf.parent_id) : null;
      if (parent) {
        const parentName = parent.name.toLowerCase();
        if (desc.includes(parentName)) {
          return { id: leaf.id, path: buildCategoryPath(leaf.id) };
        }
        for (const kw of keywords) {
          if (parentName.includes(kw) || kw.includes(parentName)) {
            return { id: leaf.id, path: buildCategoryPath(leaf.id) };
          }
        }
      }
    }

    return null;
  }, [categories, getLeafCategories, buildCategoryPath]);

  const handleParseRecords = () => {
    if (!recordText.trim()) return;
    const lines = recordText.split('\n');
    const results: typeof recordPreview = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(
        /(\d{1,2}:\d{2})\s*[-~～]\s*(\d{1,2}:\d{2})\s+(.+)/
      );
      if (match) {
        const startTime = match[1].length === 4 ? '0' + match[1] : match[1];
        const endTime = match[2].length === 4 ? '0' + match[2] : match[2];
        const description = match[3].trim();
        const matched = fuzzyMatchCategory(description);

        results.push({
          start: startTime,
          end: endTime,
          description,
          categoryId: matched?.id ?? null,
          categoryPath: matched?.path ?? null,
          originalText: trimmed,
        });
      }
    }

    setRecordPreview(results);
    setShowRecordPreview(results.length > 0);
  };

  const handleRecordCategoryChange = (index: number, categoryId: string) => {
    setRecordPreview(prev => prev.map((item, i) => {
      if (i !== index) return item;
      return {
        ...item,
        categoryId,
        categoryPath: buildCategoryPath(categoryId),
      };
    }));
  };

  const handleConfirmRecords = async () => {
    if (!userId || recordPreview.length === 0) return;
    setRecordInserting(true);
    setRecordOverlapWarning('');

    try {
      const dayStart = `${recordDate}T00:00:00`;
      const dayEnd = `${recordDate}T23:59:59`;
      const { data: existingEntries } = await supabase
        .from('tf_time_entries')
        .select('*')
        .eq('user_id', userId)
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd)
        .not('end_time', 'is', null);

      const overlaps: string[] = [];
      const toInsert: Array<{
        user_id: string;
        category_id: string;
        start_time: string;
        end_time: string;
        is_primary: boolean;
      }> = [];

      for (const record of recordPreview) {
        if (!record.categoryId) continue;
        const startISO = `${recordDate}T${record.start}:00`;
        const endISO = `${recordDate}T${record.end}:00`;
        const startMs = new Date(startISO).getTime();
        const endMs = new Date(endISO).getTime();

        if (existingEntries) {
          for (const existing of existingEntries) {
            const exStart = new Date(existing.start_time).getTime();
            const exEnd = new Date(existing.end_time).getTime();
            if (startMs < exEnd && endMs > exStart) {
              overlaps.push(`${record.start}-${record.end} ${record.description}`);
              break;
            }
          }
        }

        toInsert.push({
          user_id: userId,
          category_id: record.categoryId,
          start_time: startISO,
          end_time: endISO,
          is_primary: true,
        });
      }

      if (overlaps.length > 0) {
        const proceed = window.confirm(
          `以下记录与已有记录时间重叠:\n${overlaps.join('\n')}\n\n是否继续补录?`
        );
        if (!proceed) {
          setRecordInserting(false);
          return;
        }
      }

      if (toInsert.length === 0) {
        setRecordOverlapWarning('没有已匹配分类的记录可以补录');
        setRecordInserting(false);
        return;
      }

      await supabase.from('tf_time_entries').insert(toInsert);

      setRecordText('');
      setRecordPreview([]);
      setShowRecordPreview(false);
      setShowPasteSection(false);
      loadEntries();
    } catch {
      setRecordOverlapWarning('补录失败，请重试');
    } finally {
      setRecordInserting(false);
    }
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

  const hasPlan = planBlocks.length > 0;
  const hasEntries = todayEntries.length > 0;
  const hasReport = hasPlan && hasEntries && (matchStats || accuracyStats);

  // Format time from HH:MM:SS to HH:MM
  const fmtTime = (t: string) => t.slice(0, 5);

  // Format entry time from ISO string
  const fmtEntryTime = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col min-h-screen pb-16">
      {/* Header: Date selector */}
      <div className="bg-gray-800 text-white px-4 py-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedDate(subDays(selectedDate, 1))}
            className="px-3 py-1 text-lg"
          >
            &#8249;
          </button>
          <div className="text-center">
            <div className="text-base font-medium">{displayDate}</div>
            {isToday && <div className="text-xs text-gray-400">今天</div>}
          </div>
          <button
            onClick={() => setSelectedDate(addDays(selectedDate, 1))}
            className="px-3 py-1 text-lg"
          >
            &#8250;
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0">

        {/* ==================== Section 1: Plan ==================== */}
        <div className="mb-4">
          {/* Section header */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {'\uD83D\uDCCB'} 计划
            </h2>
            {hasPlan && !isEditingPlan && (
              <button
                onClick={() => setIsEditingPlan(true)}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                [编辑]
              </button>
            )}
          </div>

          {/* Display mode: show plan blocks as list */}
          {hasPlan && !isEditingPlan && (
            <div className="space-y-1.5">
              {planBlocks.map((block) => {
                const cat = block.matched_category_id
                  ? getCategoryById(block.matched_category_id)
                  : null;
                const parent = cat?.parent_id ? getCategoryById(cat.parent_id) : cat;
                const color = parent?.color ?? cat?.color ?? '#9ca3af';
                const status = getPlanBlockMatchStatus(block);
                const statusIcon = status === 'matched' ? '\u2705' : status === 'deviated' ? '\u274C' : '\u2B1C';

                return (
                  <div
                    key={block.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-card)]"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-xs text-[var(--text-secondary)] tabular-nums shrink-0">
                        {fmtTime(block.start_time)} - {fmtTime(block.end_time)}
                      </span>
                      <span className="text-sm text-[var(--text-primary)] truncate">
                        {block.task_name}
                      </span>
                    </div>
                    <span className="text-sm shrink-0 ml-2">{statusIcon}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Edit mode / No plan: show textarea */}
          {(!hasPlan || isEditingPlan) && (
            <div>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={"粘贴日程文字，例如:\n9:00-10:30 学法语课程\n14:00-15:00 写小说\n15:30-17:00 投简历"}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 resize-none bg-[var(--bg-card)] text-[var(--text-primary)]"
                rows={4}
              />
              <div className="flex gap-2 mt-2">
                {isEditingPlan && hasPlan && (
                  <button
                    onClick={() => setIsEditingPlan(false)}
                    className="flex-1 py-2 rounded-lg text-sm text-[var(--text-secondary)] border border-[var(--border)]"
                  >
                    取消
                  </button>
                )}
                <button
                  onClick={handleParse}
                  disabled={!rawText.trim()}
                  className="flex-1 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-40"
                >
                  保存计划
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ==================== Separator ==================== */}
        <div className="border-t border-[var(--border)] my-4" />

        {/* ==================== Section 2: Actual ==================== */}
        <div className="mb-4">
          {/* Section header */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {'\u23F1'} 实际
            </h2>
            {hasEntries && (
              <button
                onClick={() => setShowPasteSection(!showPasteSection)}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                [补录]
              </button>
            )}
          </div>

          {/* Actual entries list */}
          {hasEntries && (
            <div className="space-y-1.5">
              {actualBlocks.map((ab, i) => {
                const startStr = fmtEntryTime(ab.entry.start_time);
                const endStr = ab.entry.end_time ? fmtEntryTime(ab.entry.end_time) : '进行中';
                // Detect if manually added (heuristic: entries created via paste have exact :00 seconds)
                const startDate = new Date(ab.entry.start_time);
                const isManual = startDate.getSeconds() === 0 && startDate.getMilliseconds() === 0;

                return (
                  <div
                    key={ab.entry.id ?? i}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-card)]"
                    style={{ borderLeft: `3px solid ${ab.color}` }}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-xs text-[var(--text-secondary)] tabular-nums shrink-0">
                        {startStr} - {endStr}
                      </span>
                      <span className="text-sm text-[var(--text-primary)] truncate">
                        {ab.name}
                      </span>
                    </div>
                    <span
                      className="text-xs shrink-0 ml-2 px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: isManual ? 'var(--bg-secondary)' : `${ab.color}15`,
                        color: isManual ? 'var(--text-secondary)' : ab.color,
                      }}
                    >
                      {isManual ? '补录' : '自动'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* No entries state */}
          {!hasEntries && (
            <div className="text-center text-[var(--text-secondary)] text-sm py-4">
              今日暂无时间记录
            </div>
          )}

          {/* Paste section: shown directly when no entries, or collapsible when entries exist */}
          {(!hasEntries || showPasteSection) && (
            <div className="mt-3 space-y-3">
              {/* Date selector for records */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--text-secondary)]">日期:</label>
                <input
                  type="date"
                  value={recordDate}
                  onChange={(e) => setRecordDate(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-[var(--border)] text-sm bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
              </div>

              <textarea
                value={recordText}
                onChange={(e) => setRecordText(e.target.value)}
                placeholder={"粘贴时间记录，例如:\n9:00-10:30 学法语\n14:00-15:00 写小说第三章\n15:30~17:00 玩游戏"}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 resize-none bg-[var(--bg-card)] text-[var(--text-primary)]"
                rows={4}
              />

              <button
                onClick={handleParseRecords}
                disabled={!recordText.trim()}
                className="w-full py-2 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-40"
              >
                识别并补录
              </button>

              {/* Preview list */}
              {showRecordPreview && recordPreview.length > 0 && (
                <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
                  <div className="px-3 py-2 border-b border-[var(--border)]">
                    <span className="text-xs font-medium text-[var(--text-secondary)]">
                      识别结果 ({recordPreview.length} 条)
                    </span>
                  </div>
                  <div className="divide-y divide-[var(--border)]">
                    {recordPreview.map((item, idx) => (
                      <div key={idx} className="px-3 py-2 flex items-center gap-2">
                        <span className="text-xs text-[var(--text-secondary)] tabular-nums w-24 shrink-0">
                          {item.start}-{item.end}
                        </span>
                        {item.categoryId ? (
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <span className="text-green-500 shrink-0">{'\u2713'}</span>
                            <select
                              value={item.categoryId}
                              onChange={(e) => handleRecordCategoryChange(idx, e.target.value)}
                              className="text-xs bg-transparent text-[var(--text-primary)] border-none focus:outline-none cursor-pointer truncate flex-1 min-w-0"
                            >
                              {getLeafCategories().map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                  {buildCategoryPath(cat.id)}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <span className="text-yellow-500 shrink-0">{'\u26A0'}</span>
                            <select
                              value=""
                              onChange={(e) => handleRecordCategoryChange(idx, e.target.value)}
                              className="text-xs bg-transparent text-[var(--text-secondary)] border-none focus:outline-none cursor-pointer truncate flex-1 min-w-0"
                            >
                              <option value="" disabled>{item.description}</option>
                              {getLeafCategories().map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                  {buildCategoryPath(cat.id)}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {recordOverlapWarning && (
                    <div className="px-3 py-2 text-xs text-yellow-500">
                      {recordOverlapWarning}
                    </div>
                  )}

                  <div className="flex gap-2 px-3 py-3 border-t border-[var(--border)]">
                    <button
                      onClick={() => {
                        setShowRecordPreview(false);
                        setRecordPreview([]);
                      }}
                      className="flex-1 py-2 rounded-lg text-sm text-[var(--text-secondary)] border border-[var(--border)]"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleConfirmRecords}
                      disabled={recordInserting || recordPreview.every(r => !r.categoryId)}
                      className="flex-1 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-40"
                    >
                      {recordInserting ? '补录中...' : '确认补录'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ==================== Section 3: Report ==================== */}
        {hasReport && (
          <div className="mb-4">
            <div className="border-t border-[var(--border)] my-4" />

            {/* Collapsed header */}
            <button
              onClick={() => setShowReport(!showReport)}
              className="w-full flex items-center gap-2 text-left"
            >
              <span className="text-xs text-[var(--text-secondary)]">
                {showReport ? '\u25BC' : '\u25B6'}
              </span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {'\uD83D\uDCCA'} 今日报告
              </span>
              {matchStats && (
                <span className="text-xs text-[var(--text-secondary)] ml-auto">
                  执行匹配度 {matchStats.matchRate}%
                  {accuracyStats ? `  |  平均偏差 ${accuracyStats.avgAbsDev > 0 ? '+' : ''}${accuracyStats.avgAbsDev}%` : ''}
                </span>
              )}
            </button>

            {/* Expanded content */}
            {showReport && (
              <div className="space-y-4 mt-3">
                {/* Card 1: Match rate */}
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

                {/* Card 2: Accuracy */}
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
          </div>
        )}
      </div>
    </div>
  );
}
