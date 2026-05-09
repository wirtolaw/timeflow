import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getUserId } from '../lib/supabase';
import type { Category, TimeEntry, Project } from '../lib/types';
import { startOfDay } from 'date-fns';
import { getNotificationSettings, getContinuousWorkSettings } from './Settings';

interface CategoryGroup {
  parent: Category;
  children: Category[];
}

export default function Timer() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [secondaryEntry, setSecondaryEntry] = useState<TimeEntry | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [secondaryElapsed, setSecondaryElapsed] = useState(0);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const intervalRef = useRef<number | null>(null);
  const userId = getUserId();

  // Long press state
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);

  // Secondary task popup
  const [showSecondaryPopup, setShowSecondaryPopup] = useState(false);

  // Project selection
  const [projects, setProjects] = useState<Project[]>([]);
  const [showProjectSheet, setShowProjectSheet] = useState(false);
  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectCategoryId, setNewProjectCategoryId] = useState('');

  // Category management
  const [showCategoryEditor, setShowCategoryEditor] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatParentId, setNewCatParentId] = useState<string>('');
  const [newCatColor, setNewCatColor] = useState('#6366f1');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Notification tracking refs
  const notifiedForgotten = useRef(false);
  const notifiedContinuous = useRef(false);
  const notifiedWarnings = useRef<Set<string>>(new Set());
  const notifiedExceeded = useRef<Set<string>>(new Set());

  const loadCategories = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_categories')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order');
    if (data) setCategories(data);
  }, [userId]);

  const loadActiveEntries = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_time_entries')
      .select('*')
      .eq('user_id', userId)
      .is('end_time', null)
      .order('start_time', { ascending: false });
    if (data && data.length > 0) {
      const primary = data.find((e) => e.is_primary) ?? null;
      const secondary = data.find((e) => !e.is_primary) ?? null;
      setActiveEntry(primary);
      setSecondaryEntry(secondary);
    } else {
      setActiveEntry(null);
      setSecondaryEntry(null);
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

  const loadProjects = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('tf_projects')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at');
    if (data) setProjects(data);
  }, [userId]);

  useEffect(() => {
    loadCategories();
    loadActiveEntries();
    loadTodayEntries();
    loadProjects();
  }, [loadCategories, loadActiveEntries, loadTodayEntries, loadProjects]);

  // Elapsed time ticker
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (activeEntry || secondaryEntry) {
      const tick = () => {
        if (activeEntry) {
          const start = new Date(activeEntry.start_time).getTime();
          setElapsed(Math.floor((Date.now() - start) / 1000));
        } else {
          setElapsed(0);
        }
        if (secondaryEntry) {
          const start = new Date(secondaryEntry.start_time).getTime();
          setSecondaryElapsed(Math.floor((Date.now() - start) / 1000));
        } else {
          setSecondaryElapsed(0);
        }
      };
      tick();
      intervalRef.current = window.setInterval(tick, 1000);
    } else {
      setElapsed(0);
      setSecondaryElapsed(0);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeEntry, secondaryEntry]);

  // Reset notification tracking when timer changes
  useEffect(() => {
    notifiedForgotten.current = false;
    notifiedContinuous.current = false;
    notifiedWarnings.current = new Set();
    notifiedExceeded.current = new Set();
  }, [activeEntry?.id]);

  // Notification check interval (every 60 seconds)
  useEffect(() => {
    if (!activeEntry) return;

    const sendNotification = (title: string, body: string) => {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    };

    const checkNotifications = async () => {
      const settings = getNotificationSettings();
      if (!settings.enabled) return;

      const elapsedMs = Date.now() - new Date(activeEntry.start_time).getTime();
      const elapsedMins = elapsedMs / 60000;

      // Forgotten timer (>= 4h)
      if (settings.forgottenTimer && elapsedMins >= 240 && !notifiedForgotten.current) {
        notifiedForgotten.current = true;
        sendNotification('遗忘计时器', `计时器已运行超过4小时，请确认是否仍在进行中。`);
      }

      // Continuous work
      if (settings.continuousWork && !notifiedContinuous.current) {
        const cwSettings = getContinuousWorkSettings();
        const cat = categories.find((c) => c.id === activeEntry.category_id);
        const parent = cat?.parent_id ? categories.find((c) => c.id === cat.parent_id) : cat;
        const parentName = parent?.name ?? '';
        const isException = cwSettings.exceptionCategories.includes(parentName);
        if (!isException && elapsedMins >= cwSettings.thresholdMinutes) {
          notifiedContinuous.current = true;
          sendNotification('连续工作提醒', `你已连续工作${Math.round(elapsedMins)}分钟，建议休息一下。`);
        }
      }

      // Habit limit warnings
      if (settings.limitWarning || settings.limitExceeded) {
        // Load habits
        const { data: habits } = await supabase
          .from('tf_habits')
          .select('*')
          .eq('user_id', userId!)
          .eq('type', 'time_max');
        if (habits) {
          for (const habit of habits) {
            if (!habit.category_id) continue;
            // Compute today's total for this habit's category
            const catIds = new Set<string>();
            catIds.add(habit.category_id);
            for (const c of categories) {
              if (c.parent_id === habit.category_id) catIds.add(c.id);
            }
            // Also if habit.category_id is a child, find parent and siblings
            const habitCat = categories.find((c) => c.id === habit.category_id);
            if (habitCat?.parent_id) {
              catIds.add(habitCat.parent_id);
              for (const c of categories) {
                if (c.parent_id === habitCat.parent_id) catIds.add(c.id);
              }
            }

            let todayMins = 0;
            for (const entry of todayEntries) {
              if (!catIds.has(entry.category_id)) continue;
              const s = new Date(entry.start_time).getTime();
              const e = entry.end_time ? new Date(entry.end_time).getTime() : Date.now();
              todayMins += (e - s) / 60000;
            }
            // Also add current timer if in this category
            if (catIds.has(activeEntry.category_id)) {
              const s = new Date(activeEntry.start_time).getTime();
              todayMins += (Date.now() - s) / 60000;
            }

            const ratio = todayMins / habit.target_value;

            if (settings.limitWarning && ratio >= 0.8 && ratio < 1 && !notifiedWarnings.current.has(habit.id)) {
              notifiedWarnings.current.add(habit.id);
              sendNotification('习惯预警', `"${habit.name}" 已达到目标的${Math.round(ratio * 100)}%，请注意控制。`);
            }
            if (settings.limitExceeded && ratio >= 1 && !notifiedExceeded.current.has(habit.id)) {
              notifiedExceeded.current.add(habit.id);
              sendNotification('习惯超限', `"${habit.name}" 已超过今日限制！`);
            }
          }
        }
      }
    };

    // Check immediately, then every 60s
    checkNotifications();
    const iv = window.setInterval(checkNotifications, 60000);
    return () => clearInterval(iv);
  }, [activeEntry, todayEntries, categories, userId]);

  const getCategoryById = (id: string) => categories.find((c) => c.id === id);

  const getCategoryName = (entry: TimeEntry | null) => {
    if (!entry) return '';
    const cat = getCategoryById(entry.category_id);
    if (!cat) return '';
    const parent = cat.parent_id ? getCategoryById(cat.parent_id) : null;
    return parent ? `${parent.name} · ${cat.name}` : cat.name;
  };

  const getCategoryColor = (entry: TimeEntry | null) => {
    if (!entry) return '#6b7280';
    const cat = getCategoryById(entry.category_id);
    return cat?.color ?? '#6b7280';
  };

  const formatElapsed = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const requestNotificationPermission = () => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  const stopAllTimers = async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    await supabase
      .from('tf_time_entries')
      .update({ end_time: now })
      .eq('user_id', userId)
      .is('end_time', null);
    setActiveEntry(null);
    setSecondaryEntry(null);
    loadTodayEntries();
  };

  const stopSecondaryTimer = async () => {
    if (!secondaryEntry) return;
    await supabase
      .from('tf_time_entries')
      .update({ end_time: new Date().toISOString() })
      .eq('id', secondaryEntry.id);
    setSecondaryEntry(null);
    loadTodayEntries();
  };

  const promoteSecondary = async () => {
    if (!secondaryEntry || !activeEntry) return;
    const now = new Date().toISOString();
    await supabase
      .from('tf_time_entries')
      .update({ end_time: now })
      .eq('id', activeEntry.id);
    await supabase
      .from('tf_time_entries')
      .update({ end_time: now })
      .eq('id', secondaryEntry.id);
    const { data: newPrimary } = await supabase
      .from('tf_time_entries')
      .insert({
        user_id: userId!,
        category_id: secondaryEntry.category_id,
        project_id: secondaryEntry.project_id,
        start_time: now,
        end_time: null,
        is_primary: true,
      })
      .select()
      .single();
    const { data: newSecondary } = await supabase
      .from('tf_time_entries')
      .insert({
        user_id: userId!,
        category_id: activeEntry.category_id,
        project_id: activeEntry.project_id,
        start_time: now,
        end_time: null,
        is_primary: false,
      })
      .select()
      .single();
    setActiveEntry(newPrimary);
    setSecondaryEntry(newSecondary);
    loadTodayEntries();
  };

  const startTimer = async (categoryId: string, projectId?: string | null, asPrimary = true) => {
    if (!userId) return;
    requestNotificationPermission();
    const { data } = await supabase
      .from('tf_time_entries')
      .insert({
        user_id: userId,
        category_id: categoryId,
        project_id: projectId ?? null,
        start_time: new Date().toISOString(),
        end_time: null,
        is_primary: asPrimary,
      })
      .select()
      .single();
    if (data) {
      if (asPrimary) {
        setActiveEntry(data);
      } else {
        setSecondaryEntry(data);
      }
      loadTodayEntries();
    }
  };

  const getProjectsForCategory = (categoryId: string): Project[] => {
    const cat = getCategoryById(categoryId);
    if (!cat) return [];
    const parentId = cat.parent_id ?? cat.id;
    return projects.filter((p) => {
      const pCat = getCategoryById(p.category_id);
      if (!pCat) return false;
      const pParentId = pCat.parent_id ?? pCat.id;
      return pParentId === parentId || p.category_id === categoryId;
    });
  };

  const handleCategoryTap = async (categoryId: string) => {
    if (activeEntry) {
      if (activeEntry.category_id === categoryId) {
        await stopAllTimers();
      } else {
        await stopAllTimers();
        const catProjects = getProjectsForCategory(categoryId);
        if (catProjects.length >= 2) {
          setPendingCategoryId(categoryId);
          setShowProjectSheet(true);
        } else {
          await startTimer(categoryId, catProjects.length === 1 ? catProjects[0].id : null);
        }
      }
    } else {
      const catProjects = getProjectsForCategory(categoryId);
      if (catProjects.length >= 2) {
        setPendingCategoryId(categoryId);
        setShowProjectSheet(true);
      } else {
        await startTimer(categoryId, catProjects.length === 1 ? catProjects[0].id : null);
      }
    }
  };

  const handleProjectSelect = async (projectId: string | null) => {
    setShowProjectSheet(false);
    if (pendingCategoryId) {
      await startTimer(pendingCategoryId, projectId);
      setPendingCategoryId(null);
    }
  };

  const handleTouchStart = (categoryId: string) => {
    longPressTriggered.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      handleLongPress(categoryId);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleLongPress = async (categoryId: string) => {
    if (activeEntry && !secondaryEntry) {
      if (activeEntry.category_id === categoryId) return;
      const catProjects = getProjectsForCategory(categoryId);
      await startTimer(
        categoryId,
        catProjects.length === 1 ? catProjects[0].id : null,
        false
      );
    }
  };

  const handleSecondaryLongPress = () => {
    setShowSecondaryPopup(true);
  };

  const handleAddProject = async () => {
    if (!userId || !newProjectName.trim() || !newProjectCategoryId) return;
    await supabase.from('tf_projects').insert({
      user_id: userId,
      name: newProjectName.trim(),
      category_id: newProjectCategoryId,
      status: 'active',
    });
    setNewProjectName('');
    setNewProjectCategoryId('');
    loadProjects();
  };

  const handleCompleteProject = async (projectId: string) => {
    await supabase
      .from('tf_projects')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', projectId);
    loadProjects();
  };

  const handleAddCategory = async () => {
    if (!userId || !newCatName.trim()) return;
    const parentId = newCatParentId || null;
    const siblings = categories.filter((c) =>
      parentId ? c.parent_id === parentId : !c.parent_id
    );
    const maxOrder = siblings.reduce((max, c) => Math.max(max, c.sort_order), -1);
    await supabase.from('tf_categories').insert({
      user_id: userId,
      name: newCatName.trim(),
      parent_id: parentId,
      color: newCatColor,
      icon: parentId ? '' : '📌',
      sort_order: maxOrder + 1,
    });
    setNewCatName('');
    setNewCatParentId('');
    setNewCatColor('#6366f1');
    loadCategories();
  };

  const handleRenameCategory = async (catId: string, newName: string) => {
    if (!newName.trim()) return;
    await supabase.from('tf_categories').update({ name: newName.trim() }).eq('id', catId);
    setEditingCatId(null);
    setEditingCatName('');
    loadCategories();
  };

  const handleDeleteCategory = async (catId: string) => {
    await supabase.from('tf_categories').delete().eq('parent_id', catId);
    await supabase.from('tf_categories').delete().eq('id', catId);
    setConfirmDeleteId(null);
    loadCategories();
  };

  const parents = categories.filter((c) => !c.parent_id);
  const groups: CategoryGroup[] = parents.map((p) => ({
    parent: p,
    children: categories
      .filter((c) => c.parent_id === p.id)
      .sort((a, b) => a.sort_order - b.sort_order),
  }));

  const todaySummary = () => {
    const catMap = new Map<string, number>();
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

  const colorOptions = [
    '#3b82f6', '#22c55e', '#8b5cf6', '#f97316', '#ec4899',
    '#78716c', '#ef4444', '#14b8a6', '#f59e0b', '#6366f1',
  ];

  return (
    <div className="flex flex-col min-h-screen pb-16">
      {/* Header with action buttons */}
      <div className="bg-gray-800 text-white px-4 py-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex gap-2">
            <button
              onClick={() => setShowProjectManager(true)}
              className="text-lg opacity-70 hover:opacity-100"
              title="项目管理"
            >
              📁
            </button>
          </div>
          <span className="text-sm font-medium text-gray-300">TimeFlow</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/settings')}
              className="text-lg opacity-70 hover:opacity-100"
              title="设置"
            >
              ⚙️
            </button>
            <button
              onClick={() => setShowCategoryEditor(true)}
              className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
            >
              编辑
            </button>
          </div>
        </div>

        {/* Active timer display */}
        {activeEntry ? (
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full animate-pulse"
                  style={{ backgroundColor: getCategoryColor(activeEntry) }}
                />
                <div>
                  <div className="text-sm text-gray-300">
                    {getCategoryName(activeEntry)}
                    <span className="text-xs text-gray-500 ml-1">主</span>
                  </div>
                  <div className="text-3xl font-mono font-light tracking-wider">
                    {formatElapsed(elapsed)}
                  </div>
                </div>
              </div>
              <button
                onClick={stopAllTimers}
                className="w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
              >
                <div className="w-4 h-4 bg-white rounded-sm" />
              </button>
            </div>

            {/* Secondary timer */}
            {secondaryEntry && (
              <div
                className="mt-2 flex items-center justify-between px-3 py-2 rounded-lg border border-dashed border-gray-500 cursor-pointer"
                onTouchStart={(e) => {
                  e.stopPropagation();
                  longPressTriggered.current = false;
                  longPressTimer.current = window.setTimeout(() => {
                    longPressTriggered.current = true;
                    handleSecondaryLongPress();
                  }, 500);
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  if (longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                    longPressTimer.current = null;
                  }
                }}
                onClick={() => handleSecondaryLongPress()}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: getCategoryColor(secondaryEntry) }}
                  />
                  <span className="text-xs text-gray-400">
                    {getCategoryName(secondaryEntry)}
                    <span className="text-xs text-gray-600 ml-1">副</span>
                  </span>
                </div>
                <span className="text-sm font-mono text-gray-400">
                  {formatElapsed(secondaryElapsed)}
                </span>
              </div>
            )}
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
                const isActive = activeEntry?.category_id === child.id;
                const isSecondary = secondaryEntry?.category_id === child.id;
                return (
                  <button
                    key={child.id}
                    onClick={(e) => {
                      if (longPressTriggered.current) {
                        e.preventDefault();
                        return;
                      }
                      handleCategoryTap(child.id);
                    }}
                    onTouchStart={() => handleTouchStart(child.id)}
                    onTouchEnd={handleTouchEnd}
                    onMouseDown={() => handleTouchStart(child.id)}
                    onMouseUp={handleTouchEnd}
                    onMouseLeave={handleTouchEnd}
                    className={`relative text-left px-3 py-2.5 rounded-lg text-sm transition-all border ${
                      isActive
                        ? 'text-white shadow-md scale-[1.02]'
                        : isSecondary
                        ? 'shadow-sm scale-[1.01]'
                        : 'bg-[var(--bg-card)] hover:opacity-80 border-[var(--border)]'
                    }`}
                    style={
                      isActive
                        ? {
                            backgroundColor: child.color,
                            borderColor: child.color,
                            color: '#fff',
                          }
                        : isSecondary
                        ? {
                            borderColor: child.color,
                            borderWidth: '2px',
                            borderStyle: 'dashed',
                            backgroundColor: 'var(--bg-card)',
                            color: 'var(--text-primary)',
                          }
                        : {
                            borderLeftColor: child.color,
                            borderLeftWidth: '3px',
                            color: 'var(--text-primary)',
                          }
                    }
                  >
                    {child.name}
                    {isActive && (
                      <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    )}
                    {isSecondary && (
                      <span
                        className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ backgroundColor: child.color }}
                      />
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
        <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
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
          <div className="text-xs text-[var(--text-secondary)] text-center">
            今日已记录 {formatDuration(totalSeconds)}
          </div>
        </div>
      )}

      {/* Secondary task popup */}
      {showSecondaryPopup && secondaryEntry && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setShowSecondaryPopup(false)}
        >
          <div
            className="bg-[var(--bg-card)] rounded-2xl p-5 mx-6 w-full max-w-sm space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center text-sm text-[var(--text-secondary)] mb-2">
              副任务: {getCategoryName(secondaryEntry)}
            </div>
            <button
              onClick={async () => {
                setShowSecondaryPopup(false);
                await promoteSecondary();
              }}
              className="w-full py-3 rounded-xl bg-gray-800 text-white text-sm font-medium"
            >
              升为主任务
            </button>
            <button
              onClick={async () => {
                setShowSecondaryPopup(false);
                await stopSecondaryTimer();
              }}
              className="w-full py-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium dark:bg-red-900/20 dark:text-red-400"
            >
              停止此任务
            </button>
            <button
              onClick={() => setShowSecondaryPopup(false)}
              className="w-full py-2 text-sm text-[var(--text-secondary)]"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Project selection bottom sheet */}
      {showProjectSheet && pendingCategoryId && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"
          onClick={() => {
            setShowProjectSheet(false);
            setPendingCategoryId(null);
          }}
        >
          <div
            className="bg-[var(--bg-card)] rounded-t-2xl p-5 w-full max-w-[430px] space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center text-sm font-medium text-[var(--text-primary)] mb-3">选择项目</div>
            {getProjectsForCategory(pendingCategoryId).map((proj) => (
              <button
                key={proj.id}
                onClick={() => handleProjectSelect(proj.id)}
                className="w-full py-3 px-4 rounded-xl bg-[var(--bg-secondary)] hover:opacity-80 text-sm text-left text-[var(--text-primary)] transition-colors"
              >
                {proj.name}
              </button>
            ))}
            <button
              onClick={() => handleProjectSelect(null)}
              className="w-full py-3 px-4 rounded-xl bg-[var(--bg-secondary)] hover:opacity-80 text-sm text-left text-[var(--text-secondary)]"
            >
              不选择项目
            </button>
            <button
              onClick={() => {
                setShowProjectSheet(false);
                setPendingCategoryId(null);
              }}
              className="w-full py-2 text-sm text-[var(--text-secondary)] text-center"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Project manager modal */}
      {showProjectManager && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setShowProjectManager(false)}
        >
          <div
            className="bg-[var(--bg-card)] rounded-2xl p-5 mx-4 w-full max-w-sm max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-[var(--text-primary)]">项目管理</h3>
              <button
                onClick={() => setShowProjectManager(false)}
                className="text-[var(--text-secondary)] text-lg"
              >
                ✕
              </button>
            </div>

            {parents.map((parent) => {
              const parentProjects = projects.filter((p) => {
                const pCat = getCategoryById(p.category_id);
                if (!pCat) return false;
                return (pCat.parent_id ?? pCat.id) === parent.id;
              });
              if (parentProjects.length === 0) return null;
              return (
                <div key={parent.id} className="mb-3">
                  <div className="text-xs font-medium mb-1" style={{ color: parent.color }}>
                    {parent.name}
                  </div>
                  {parentProjects.map((proj) => (
                    <div
                      key={proj.id}
                      className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[var(--bg-secondary)]"
                    >
                      <span className="text-sm text-[var(--text-primary)]">{proj.name}</span>
                      <button
                        onClick={() => handleCompleteProject(proj.id)}
                        className="text-xs px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400"
                      >
                        完成
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}

            {projects.length === 0 && (
              <div className="text-sm text-[var(--text-secondary)] text-center py-4">暂无活跃项目</div>
            )}

            <div className="border-t border-[var(--border)] mt-3 pt-3 space-y-2">
              <div className="text-xs font-medium text-[var(--text-secondary)]">新增项目</div>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="项目名称"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 bg-[var(--bg-primary)] text-[var(--text-primary)]"
              />
              <select
                value={newProjectCategoryId}
                onChange={(e) => setNewProjectCategoryId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 bg-[var(--bg-primary)] text-[var(--text-primary)]"
              >
                <option value="">选择分类</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAddProject}
                disabled={!newProjectName.trim() || !newProjectCategoryId}
                className="w-full py-2 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-40"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category editor modal */}
      {showCategoryEditor && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setShowCategoryEditor(false)}
        >
          <div
            className="bg-[var(--bg-card)] rounded-2xl p-5 mx-4 w-full max-w-sm max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-[var(--text-primary)]">分类管理</h3>
              <button
                onClick={() => setShowCategoryEditor(false)}
                className="text-[var(--text-secondary)] text-lg"
              >
                ✕
              </button>
            </div>

            {groups.map((group) => (
              <div key={group.parent.id} className="mb-3">
                <div className="flex items-center justify-between py-1">
                  {editingCatId === group.parent.id ? (
                    <input
                      type="text"
                      value={editingCatName}
                      onChange={(e) => setEditingCatName(e.target.value)}
                      onBlur={() => handleRenameCategory(group.parent.id, editingCatName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameCategory(group.parent.id, editingCatName);
                      }}
                      className="text-sm font-medium px-2 py-1 border border-[var(--border)] rounded focus:outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                      autoFocus
                    />
                  ) : (
                    <span
                      className="text-sm font-medium cursor-pointer"
                      style={{ color: group.parent.color }}
                      onClick={() => {
                        setEditingCatId(group.parent.id);
                        setEditingCatName(group.parent.name);
                      }}
                    >
                      {group.parent.icon} {group.parent.name}
                    </span>
                  )}
                  {confirmDeleteId === group.parent.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleDeleteCategory(group.parent.id)}
                        className="text-xs px-2 py-1 rounded bg-red-500 text-white"
                      >
                        确认
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs px-2 py-1 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(group.parent.id)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      删除
                    </button>
                  )}
                </div>
                {group.children.map((child) => (
                  <div key={child.id} className="flex items-center justify-between pl-4 py-1">
                    {editingCatId === child.id ? (
                      <input
                        type="text"
                        value={editingCatName}
                        onChange={(e) => setEditingCatName(e.target.value)}
                        onBlur={() => handleRenameCategory(child.id, editingCatName)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameCategory(child.id, editingCatName);
                        }}
                        className="text-xs px-2 py-1 border border-[var(--border)] rounded focus:outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="text-xs text-[var(--text-secondary)] cursor-pointer"
                        onClick={() => {
                          setEditingCatId(child.id);
                          setEditingCatName(child.name);
                        }}
                      >
                        {child.name}
                      </span>
                    )}
                    {confirmDeleteId === child.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleDeleteCategory(child.id)}
                          className="text-xs px-2 py-1 rounded bg-red-500 text-white"
                        >
                          确认
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs px-2 py-1 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(child.id)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        删除
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}

            <div className="border-t border-[var(--border)] mt-3 pt-3 space-y-2">
              <div className="text-xs font-medium text-[var(--text-secondary)]">新增分类</div>
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="分类名称"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 bg-[var(--bg-primary)] text-[var(--text-primary)]"
              />
              <select
                value={newCatParentId}
                onChange={(e) => setNewCatParentId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 bg-[var(--bg-primary)] text-[var(--text-primary)]"
              >
                <option value="">作为顶级分类</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} 的子分类
                  </option>
                ))}
              </select>
              <div className="flex gap-1.5 flex-wrap">
                {colorOptions.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewCatColor(c)}
                    className={`w-6 h-6 rounded-full border-2 transition-transform ${
                      newCatColor === c ? 'border-gray-800 scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button
                onClick={handleAddCategory}
                disabled={!newCatName.trim()}
                className="w-full py-2 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-40"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
