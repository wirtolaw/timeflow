import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getUserId } from '../lib/supabase';
import type { Category, TimeEntry, Project } from '../lib/types';
import { startOfDay } from 'date-fns';

interface CategoryGroup {
  parent: Category;
  children: Category[];
}

export default function Timer() {
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
    // Demote current primary to secondary
    await supabase
      .from('tf_time_entries')
      .update({ end_time: now })
      .eq('id', activeEntry.id);
    // Promote secondary: end old, start new primary with same category
    await supabase
      .from('tf_time_entries')
      .update({ end_time: now })
      .eq('id', secondaryEntry.id);
    // Start new primary for old secondary's category
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
    // Start new secondary for old primary's category
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

  // Get projects for a category (check category and its parent)
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
        // Tapping active category stops all
        await stopAllTimers();
      } else {
        // Switch primary: stop all, start new
        await stopAllTimers();
        // Check projects
        const catProjects = getProjectsForCategory(categoryId);
        if (catProjects.length >= 2) {
          setPendingCategoryId(categoryId);
          setShowProjectSheet(true);
        } else {
          await startTimer(categoryId, catProjects.length === 1 ? catProjects[0].id : null);
        }
      }
    } else {
      // No active entry, start new
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

  // Long press handlers
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
      // Start as secondary task
      if (activeEntry.category_id === categoryId) return; // Can't secondary same task
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

  // Project management
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

  // Category management
  const handleAddCategory = async () => {
    if (!userId || !newCatName.trim()) return;
    const parentId = newCatParentId || null;
    // Get max sort_order
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
    // Delete children first
    await supabase.from('tf_categories').delete().eq('parent_id', catId);
    await supabase.from('tf_categories').delete().eq('id', catId);
    setConfirmDeleteId(null);
    loadCategories();
  };

  // Group categories: parents with their children
  const parents = categories.filter((c) => !c.parent_id);
  const groups: CategoryGroup[] = parents.map((p) => ({
    parent: p,
    children: categories
      .filter((c) => c.parent_id === p.id)
      .sort((a, b) => a.sort_order - b.sort_order),
  }));

  // Today summary
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
          <button
            onClick={() => setShowCategoryEditor(true)}
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
          >
            编辑
          </button>
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
                        ? 'text-gray-700 shadow-sm scale-[1.01]'
                        : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-100'
                    }`}
                    style={
                      isActive
                        ? {
                            backgroundColor: child.color,
                            borderColor: child.color,
                          }
                        : isSecondary
                        ? {
                            borderColor: child.color,
                            borderWidth: '2px',
                            borderStyle: 'dashed',
                            backgroundColor: '#f9fafb',
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

      {/* Secondary task popup */}
      {showSecondaryPopup && secondaryEntry && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setShowSecondaryPopup(false)}
        >
          <div
            className="bg-white rounded-2xl p-5 mx-6 w-full max-w-sm space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center text-sm text-gray-500 mb-2">
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
              className="w-full py-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium"
            >
              停止此任务
            </button>
            <button
              onClick={() => setShowSecondaryPopup(false)}
              className="w-full py-2 text-sm text-gray-400"
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
            className="bg-white rounded-t-2xl p-5 w-full max-w-[430px] space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center text-sm font-medium text-gray-700 mb-3">选择项目</div>
            {getProjectsForCategory(pendingCategoryId).map((proj) => (
              <button
                key={proj.id}
                onClick={() => handleProjectSelect(proj.id)}
                className="w-full py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 text-sm text-left text-gray-700 transition-colors"
              >
                {proj.name}
              </button>
            ))}
            <button
              onClick={() => handleProjectSelect(null)}
              className="w-full py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 text-sm text-left text-gray-400"
            >
              不选择项目
            </button>
            <button
              onClick={() => {
                setShowProjectSheet(false);
                setPendingCategoryId(null);
              }}
              className="w-full py-2 text-sm text-gray-400 text-center"
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
            className="bg-white rounded-2xl p-5 mx-4 w-full max-w-sm max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-gray-800">项目管理</h3>
              <button
                onClick={() => setShowProjectManager(false)}
                className="text-gray-400 text-lg"
              >
                ✕
              </button>
            </div>

            {/* Project list grouped by category */}
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
                      className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-gray-50"
                    >
                      <span className="text-sm text-gray-700">{proj.name}</span>
                      <button
                        onClick={() => handleCompleteProject(proj.id)}
                        className="text-xs px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100"
                      >
                        完成
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}

            {projects.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-4">暂无活跃项目</div>
            )}

            {/* Add new project */}
            <div className="border-t border-gray-100 mt-3 pt-3 space-y-2">
              <div className="text-xs font-medium text-gray-500">新增项目</div>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="项目名称"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300"
              />
              <select
                value={newProjectCategoryId}
                onChange={(e) => setNewProjectCategoryId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white"
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
            className="bg-white rounded-2xl p-5 mx-4 w-full max-w-sm max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-gray-800">分类管理</h3>
              <button
                onClick={() => setShowCategoryEditor(false)}
                className="text-gray-400 text-lg"
              >
                ✕
              </button>
            </div>

            {/* Existing categories */}
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
                      className="text-sm font-medium px-2 py-1 border border-gray-300 rounded focus:outline-none"
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
                        className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500"
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
                        className="text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="text-xs text-gray-600 cursor-pointer"
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
                          className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500"
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

            {/* Add new category */}
            <div className="border-t border-gray-100 mt-3 pt-3 space-y-2">
              <div className="text-xs font-medium text-gray-500">新增分类</div>
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="分类名称"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300"
              />
              <select
                value={newCatParentId}
                onChange={(e) => setNewCatParentId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white"
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
