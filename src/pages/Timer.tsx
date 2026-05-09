import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getUserId } from '../lib/supabase';
import type { Category, TimeEntry } from '../lib/types';
import { startOfDay } from 'date-fns';

interface CategoryGroup {
  parent: Category;
  children: Category[];
}

export default function Timer() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const intervalRef = useRef<number | null>(null);
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

  const loadActiveEntry = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_time_entries')
      .select('*')
      .eq('user_id', userId)
      .is('end_time', null)
      .order('start_time', { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      setActiveEntry(data[0]);
    } else {
      setActiveEntry(null);
    }
  }, [userId]);

  const loadTodayEntries = useCallback(async () => {
    if (!userId) return;
    const todayStart = startOfDay(new Date()).toISOString();
    const { data } = await supabase
      .from('tf_time_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('start_time', todayStart)
      .order('start_time');
    if (data) setTodayEntries(data);
  }, [userId]);

  useEffect(() => {
    loadCategories();
    loadActiveEntry();
    loadTodayEntries();
  }, [loadCategories, loadActiveEntry, loadTodayEntries]);

  // Elapsed time ticker
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (activeEntry) {
      const tick = () => {
        const start = new Date(activeEntry.start_time).getTime();
        setElapsed(Math.floor((Date.now() - start) / 1000));
      };
      tick();
      intervalRef.current = window.setInterval(tick, 1000);
    } else {
      setElapsed(0);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeEntry]);

  const getCategoryById = (id: string) => categories.find((c) => c.id === id);

  const getActiveCategoryName = () => {
    if (!activeEntry) return '';
    const cat = getCategoryById(activeEntry.category_id);
    if (!cat) return '';
    const parent = cat.parent_id ? getCategoryById(cat.parent_id) : null;
    return parent ? `${parent.name} · ${cat.name}` : cat.name;
  };

  const getActiveCategoryColor = () => {
    if (!activeEntry) return '#6b7280';
    const cat = getCategoryById(activeEntry.category_id);
    return cat?.color ?? '#6b7280';
  };

  const formatElapsed = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const stopTimer = async () => {
    if (!activeEntry) return;
    await supabase
      .from('tf_time_entries')
      .update({ end_time: new Date().toISOString() })
      .eq('id', activeEntry.id);
    setActiveEntry(null);
    loadTodayEntries();
  };

  const startTimer = async (categoryId: string) => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_time_entries')
      .insert({
        user_id: userId,
        category_id: categoryId,
        start_time: new Date().toISOString(),
        end_time: null,
        is_primary: true,
      })
      .select()
      .single();
    if (data) {
      setActiveEntry(data);
      loadTodayEntries();
    }
  };

  const handleCategoryTap = async (categoryId: string) => {
    if (activeEntry) {
      if (activeEntry.category_id === categoryId) {
        await stopTimer();
      } else {
        await stopTimer();
        await startTimer(categoryId);
      }
    } else {
      await startTimer(categoryId);
    }
  };

  // Group categories: parents with their children
  const parents = categories.filter((c) => !c.parent_id);
  const groups: CategoryGroup[] = parents.map((p) => ({
    parent: p,
    children: categories
      .filter((c) => c.parent_id === p.id)
      .sort((a, b) => a.sort_order - b.sort_order),
  }));

  // Today summary: time per top-level category
  const todaySummary = () => {
    const catMap = new Map<string, number>(); // parent_id -> seconds
    for (const entry of todayEntries) {
      const cat = getCategoryById(entry.category_id);
      if (!cat) continue;
      const parentId = cat.parent_id ?? cat.id;
      const end = entry.end_time ? new Date(entry.end_time).getTime() : Date.now();
      const start = new Date(entry.start_time).getTime();
      const secs = Math.max(0, Math.floor((end - start) / 1000));
      catMap.set(parentId, (catMap.get(parentId) ?? 0) + secs);
    }
    return catMap;
  };

  const summary = todaySummary();
  const totalSeconds = Array.from(summary.values()).reduce((a, b) => a + b, 0);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h${m > 0 ? `${m}m` : ''}`;
    return `${m}m`;
  };

  return (
    <div className="flex flex-col min-h-screen pb-16">
      {/* Active timer display */}
      <div className="bg-gray-800 text-white px-4 py-5">
        {activeEntry ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full animate-pulse"
                style={{ backgroundColor: getActiveCategoryColor() }}
              />
              <div>
                <div className="text-sm text-gray-300">{getActiveCategoryName()}</div>
                <div className="text-3xl font-mono font-light tracking-wider">
                  {formatElapsed(elapsed)}
                </div>
              </div>
            </div>
            <button
              onClick={stopTimer}
              className="w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
            >
              <div className="w-4 h-4 bg-white rounded-sm" />
            </button>
          </div>
        ) : (
          <div className="text-center text-gray-400 py-2">未在计时</div>
        )}
      </div>

      {/* Category buttons */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {groups.map((group) => (
          <div key={group.parent.id}>
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="text-sm">{group.parent.icon}</span>
              <span
                className="text-sm font-medium"
                style={{ color: group.parent.color }}
              >
                {group.parent.name}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {group.children.map((child) => {
                const isActive =
                  activeEntry?.category_id === child.id;
                return (
                  <button
                    key={child.id}
                    onClick={() => handleCategoryTap(child.id)}
                    className={`relative text-left px-3 py-2.5 rounded-lg text-sm transition-all border ${
                      isActive
                        ? 'text-white shadow-md scale-[1.02]'
                        : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-100'
                    }`}
                    style={
                      isActive
                        ? {
                            backgroundColor: child.color,
                            borderColor: child.color,
                          }
                        : {
                            borderLeftColor: child.color,
                            borderLeftWidth: '3px',
                          }
                    }
                  >
                    {child.name}
                    {isActive && (
                      <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Today summary bar */}
      {totalSeconds > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
          <div className="flex h-3 rounded-full overflow-hidden mb-1.5">
            {Array.from(summary.entries()).map(([parentId, secs]) => {
              const parent = getCategoryById(parentId);
              if (!parent) return null;
              const pct = (secs / totalSeconds) * 100;
              return (
                <div
                  key={parentId}
                  style={{
                    width: `${pct}%`,
                    backgroundColor: parent.color,
                  }}
                  title={`${parent.name}: ${formatDuration(secs)}`}
                />
              );
            })}
          </div>
          <div className="text-xs text-gray-500 text-center">
            今日已记录 {formatDuration(totalSeconds)}
          </div>
        </div>
      )}
    </div>
  );
}
