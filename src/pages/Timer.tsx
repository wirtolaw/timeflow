import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getUserId } from '../lib/supabase';
import type { Category, TimeEntry, Project } from '../lib/types';
import { startOfDay, subDays } from 'date-fns';
import { getNotificationSettings, getContinuousWorkSettings } from './Settings';

interface CategoryGroup {
  parent: Category;
  children: Category[];
}

// Bubble gradient colors for top-level categories by name
const BUBBLE_COLORS: Record<string, [string, string]> = {
  '找工作': ['#B8D4E3', '#A3C4D6'],
  '学法语': ['#C2D5C0', '#AECBAB'],
  '写小说': ['#D0C4DF', '#BFB0D2'],
  '做app': ['#F0D5C0', '#E5C4AC'],
  '猫': ['#E8CDD0', '#DDBBC0'],
  '生活': ['#DDD5C8', '#CFC5B5'],
  '娱乐': ['#E8C4B8', '#DBB3A5'],
};

const DEFAULT_BUBBLE_COLOR: [string, string] = ['#D0D5DD', '#C0C5CD'];

function getBubbleColors(name: string): [string, string] {
  return BUBBLE_COLORS[name] ?? DEFAULT_BUBBLE_COLOR;
}

// Darken a hex color by a percentage (for dark mode)
function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.floor((num >> 16) * (1 - percent)));
  const g = Math.max(0, Math.floor(((num >> 8) & 0x00ff) * (1 - percent)));
  const b = Math.max(0, Math.floor((num & 0x0000ff) * (1 - percent)));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

// Mix a color with white by a ratio (0 = original, 1 = white)
function mixWithWhite(hex: string, ratio: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.floor((num >> 16) + (255 - (num >> 16)) * ratio);
  const g = Math.floor(((num >> 8) & 0xff) + (255 - ((num >> 8) & 0xff)) * ratio);
  const b = Math.floor((num & 0xff) + (255 - (num & 0xff)) * ratio);
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

// Darken for text
function darkenForText(hex: string): string {
  return darkenColor(hex, 0.45);
}

// CSS for bubble floating animations (injected once)
const BUBBLE_STYLE_ID = 'bubble-float-styles';
function ensureBubbleStyles() {
  if (document.getElementById(BUBBLE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = BUBBLE_STYLE_ID;
  style.textContent = `
    @keyframes bubbleFloat0 {
      0%, 100% { transform: translateY(0px) scale(1); }
      50% { transform: translateY(-3px) scale(1.01); }
    }
    @keyframes bubbleFloat1 {
      0%, 100% { transform: translateY(0px) scale(1); }
      50% { transform: translateY(-5px) scale(1.02); }
    }
    @keyframes bubbleFloat2 {
      0%, 100% { transform: translateY(0px) scale(1); }
      50% { transform: translateY(-4px) scale(1.015); }
    }
    @keyframes bubbleFloat3 {
      0%, 100% { transform: translateY(0px) scale(1.01); }
      50% { transform: translateY(-3px) scale(0.99); }
    }
    @keyframes bubbleFloat4 {
      0%, 100% { transform: translateY(-2px) scale(1); }
      50% { transform: translateY(2px) scale(1.02); }
    }
    @keyframes glowPulse {
      0%, 100% { box-shadow: 0 0 8px 2px rgba(239,68,68,0.4); }
      50% { box-shadow: 0 0 18px 6px rgba(239,68,68,0.7); }
    }
    @keyframes glowPulseDashed {
      0%, 100% { box-shadow: 0 0 6px 1px rgba(251,191,36,0.3); }
      50% { box-shadow: 0 0 14px 4px rgba(251,191,36,0.6); }
    }
    @keyframes pillAppear {
      from { opacity: 0; transform: translateY(8px) scale(0.9); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;
  document.head.appendChild(style);
}

interface BubblePosition {
  x: number;
  y: number;
  size: number;
}

// Simple force-directed layout for bubbles
function computeBubbleLayout(
  sizes: number[],
  containerWidth: number,
  containerHeight: number
): BubblePosition[] {
  const n = sizes.length;
  if (n === 0) return [];

  const cx = containerWidth / 2;
  const cy = containerHeight / 2;

  // Sort indices by size descending for center placement
  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => sizes[b] - sizes[a]);

  // Initial placement in a rough circle, larger toward center
  const positions: BubblePosition[] = new Array(n);
  const angleStep = (2 * Math.PI) / n;

  for (let rank = 0; rank < n; rank++) {
    const i = indices[rank];
    const radiusFactor = 0.15 + (rank / n) * 0.55;
    const maxRadius = Math.min(containerWidth, containerHeight) * 0.35;
    const r = maxRadius * radiusFactor;
    const angle = angleStep * rank - Math.PI / 2;
    // Add seeded pseudo-random offset based on index
    const offsetX = ((i * 37 + 13) % 20) - 10;
    const offsetY = ((i * 53 + 7) % 20) - 10;
    positions[i] = {
      x: cx + r * Math.cos(angle) + offsetX,
      y: cy + r * Math.sin(angle) + offsetY,
      size: sizes[i],
    };
  }

  // Simple repulsion passes to avoid overlap
  for (let pass = 0; pass < 30; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = (positions[i].size + positions[j].size) / 2 + 8;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          positions[i].x -= nx * push;
          positions[i].y -= ny * push;
          positions[j].x += nx * push;
          positions[j].y += ny * push;
        }
      }
    }

    // Keep bubbles in bounds
    for (let i = 0; i < n; i++) {
      const r = positions[i].size / 2;
      positions[i].x = Math.max(r + 4, Math.min(containerWidth - r - 4, positions[i].x));
      positions[i].y = Math.max(r + 4, Math.min(containerHeight - r - 4, positions[i].y));
    }
  }

  return positions;
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

  // Bubble UI state
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]); // stack of category IDs for nested nav
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingParentId, setEditingParentId] = useState<string | null>(null);
  const bubbleContainerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 350, height: 350 });

  // Task action sheet (when timer running and user clicks a leaf)
  const [showTaskActionSheet, setShowTaskActionSheet] = useState(false);
  const [pendingLeafCategoryId, setPendingLeafCategoryId] = useState<string | null>(null);

  // 7-day usage for bubble sizing
  const [weekUsage, setWeekUsage] = useState<Map<string, number>>(new Map());

  // Dark mode detection
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () => {
      setIsDark(document.documentElement.classList.contains('dark') || document.body.classList.contains('dark'));
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    ensureBubbleStyles();
  }, []);

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

  const loadWeekUsage = useCallback(async () => {
    if (!userId) return;
    const weekAgo = subDays(new Date(), 7).toISOString();
    const { data } = await supabase
      .from('tf_time_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('start_time', weekAgo);
    if (data) {
      const usage = new Map<string, number>();
      for (const entry of data) {
        const end = entry.end_time ? new Date(entry.end_time).getTime() : Date.now();
        const start = new Date(entry.start_time).getTime();
        const secs = Math.max(0, (end - start) / 1000);
        // Map to parent category
        const cat = categories.find((c) => c.id === entry.category_id);
        if (!cat) continue;
        const parentId = cat.parent_id ?? cat.id;
        usage.set(parentId, (usage.get(parentId) ?? 0) + secs);
      }
      setWeekUsage(usage);
    }
  }, [userId, categories]);

  useEffect(() => {
    loadCategories();
    loadActiveEntries();
    loadTodayEntries();
    loadProjects();
  }, [loadCategories, loadActiveEntries, loadTodayEntries, loadProjects]);

  useEffect(() => {
    if (categories.length > 0) loadWeekUsage();
  }, [categories, loadWeekUsage]);

  // Measure container
  useEffect(() => {
    const el = bubbleContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        const { data: habits } = await supabase
          .from('tf_habits')
          .select('*')
          .eq('user_id', userId!)
          .eq('type', 'time_max');
        if (habits) {
          for (const habit of habits) {
            if (!habit.category_id) continue;
            const catIds = new Set<string>();
            catIds.add(habit.category_id);
            for (const c of categories) {
              if (c.parent_id === habit.category_id) catIds.add(c.id);
            }
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
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatElapsedShort = (seconds: number) => {
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

  // When timer is running, show action sheet instead of direct switch
  const handleLeafTap = (categoryId: string) => {
    if (activeEntry) {
      // If tapping the currently active category, just stop
      if (activeEntry.category_id === categoryId) {
        stopAllTimers();
        return;
      }
      // Show task action sheet
      setPendingLeafCategoryId(categoryId);
      setShowTaskActionSheet(true);
    } else {
      handleCategoryTap(categoryId);
    }
  };

  const handleTaskActionSwitch = async () => {
    setShowTaskActionSheet(false);
    if (pendingLeafCategoryId) {
      await stopAllTimers();
      const catProjects = getProjectsForCategory(pendingLeafCategoryId);
      if (catProjects.length >= 2) {
        setPendingCategoryId(pendingLeafCategoryId);
        setShowProjectSheet(true);
      } else {
        await startTimer(pendingLeafCategoryId, catProjects.length === 1 ? catProjects[0].id : null);
      }
      setPendingLeafCategoryId(null);
    }
  };

  const handleTaskActionSecondary = async () => {
    setShowTaskActionSheet(false);
    if (pendingLeafCategoryId && activeEntry && !secondaryEntry) {
      const catProjects = getProjectsForCategory(pendingLeafCategoryId);
      await startTimer(
        pendingLeafCategoryId,
        catProjects.length === 1 ? catProjects[0].id : null,
        false
      );
      setPendingLeafCategoryId(null);
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
    if (h > 0) return `${h}h ${m > 0 ? `${m}min` : ''}`;
    return `${m}min`;
  };

  const colorOptions = [
    '#3b82f6', '#22c55e', '#8b5cf6', '#f97316', '#ec4899',
    '#78716c', '#ef4444', '#14b8a6', '#f59e0b', '#6366f1',
  ];

  // Compute bubble sizes based on week usage
  const bubbleSizes = useMemo(() => {
    if (parents.length === 0) return [];
    const usages = parents.map((p) => weekUsage.get(p.id) ?? 0);
    const maxUsage = Math.max(...usages);
    if (maxUsage === 0) return parents.map(() => 90);
    return usages.map((u) => {
      const ratio = u / maxUsage;
      return Math.round(70 + ratio * 50); // 70-120px
    });
  }, [parents, weekUsage]);

  // Compute bubble positions
  const bubblePositions = useMemo(() => {
    if (parents.length === 0 || containerSize.width === 0) return [];
    return computeBubbleLayout(bubbleSizes, containerSize.width, containerSize.height);
  }, [parents, bubbleSizes, containerSize]);

  // Find which parent has an active timer
  const activeParentId = useMemo(() => {
    if (!activeEntry) return null;
    const cat = getCategoryById(activeEntry.category_id);
    if (!cat) return null;
    return cat.parent_id ?? cat.id;
  }, [activeEntry, categories]);

  const secondaryParentId = useMemo(() => {
    if (!secondaryEntry) return null;
    const cat = getCategoryById(secondaryEntry.category_id);
    if (!cat) return null;
    return cat.parent_id ?? cat.id;
  }, [secondaryEntry, categories]);

  // Get children for current breadcrumb level
  const getCurrentChildren = useCallback(() => {
    if (!expandedParentId) return [];
    if (breadcrumb.length === 0) {
      // Direct children of the expanded parent
      return categories
        .filter((c) => c.parent_id === expandedParentId)
        .sort((a, b) => a.sort_order - b.sort_order);
    }
    // Children of the last breadcrumb item
    const currentId = breadcrumb[breadcrumb.length - 1];
    return categories
      .filter((c) => c.parent_id === currentId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [expandedParentId, breadcrumb, categories]);

  // Check if a category is a leaf node (has no children)
  const isLeaf = useCallback(
    (catId: string) => !categories.some((c) => c.parent_id === catId),
    [categories]
  );

  // Handle subcategory pill click
  const handlePillClick = (cat: Category) => {
    if (isLeaf(cat.id)) {
      // Start timer
      handleLeafTap(cat.id);
    } else {
      // Navigate deeper
      setBreadcrumb((prev) => [...prev, cat.id]);
    }
  };

  // Breadcrumb navigation
  const handleBreadcrumbClick = (index: number) => {
    setBreadcrumb((prev) => prev.slice(0, index));
  };

  // Collapse back to overview
  const collapseToOverview = () => {
    setExpandedParentId(null);
    setBreadcrumb([]);
  };

  // Handle bubble click
  const handleBubbleClick = (parentId: string) => {
    if (isEditMode) {
      setEditingParentId(parentId);
      setShowCategoryEditor(true);
      return;
    }
    setExpandedParentId(parentId);
    setBreadcrumb([]);
  };

  // Build breadcrumb labels
  const breadcrumbLabels = useMemo(() => {
    if (!expandedParentId) return [];
    const parent = getCategoryById(expandedParentId);
    const labels = [parent?.name ?? ''];
    for (const id of breadcrumb) {
      const cat = getCategoryById(id);
      labels.push(cat?.name ?? '');
    }
    return labels;
  }, [expandedParentId, breadcrumb, categories]);

  const currentChildren = getCurrentChildren();
  const expandedParent = expandedParentId ? getCategoryById(expandedParentId) : null;

  return (
    <div className="flex flex-col min-h-screen pb-16 bg-[var(--bg-primary)]">
      {/* ====== TOP TIMER BAR (Sticky) ====== */}
      <div
        className="sticky top-0 z-40 transition-all duration-300"
        style={{ backgroundColor: isDark ? '#1a1a1a' : '#111827' }}
      >
        {activeEntry ? (
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className="w-3 h-3 rounded-full animate-pulse flex-shrink-0"
                  style={{ backgroundColor: getCategoryColor(activeEntry) }}
                />
                <div className="min-w-0">
                  <div className="text-sm text-gray-300 truncate">
                    {getCategoryName(activeEntry)}
                  </div>
                  <div className="text-3xl font-mono font-light tracking-wider text-white">
                    {formatElapsed(elapsed)}
                  </div>
                </div>
              </div>
              <button
                onClick={stopAllTimers}
                className="w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors flex-shrink-0"
              >
                <div className="w-4 h-4 bg-white rounded-sm" />
              </button>
            </div>

            {/* Secondary timer */}
            {secondaryEntry && (
              <div
                className="mt-2 flex items-center justify-between px-3 py-1.5 rounded-lg border border-dashed border-gray-500 cursor-pointer"
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
                  {formatElapsedShort(secondaryElapsed)}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="h-10 flex items-center justify-center">
            <span className="text-sm text-gray-500">点击下方开始计时</span>
          </div>
        )}
      </div>

      {/* ====== HEADER ACTIONS ====== */}
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex gap-2">
          <button
            onClick={() => setShowProjectManager(true)}
            className="text-lg opacity-70 hover:opacity-100"
            title="项目管理"
          >
            📁
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="text-lg opacity-70 hover:opacity-100"
            title="设置"
          >
            ⚙️
          </button>
        </div>
        {expandedParentId && !isEditMode && (
          <button
            onClick={collapseToOverview}
            className="text-sm text-[var(--text-secondary)] flex items-center gap-1"
          >
            <span>←</span> 返回
          </button>
        )}
        <button
          onClick={() => {
            if (isEditMode) {
              setIsEditMode(false);
            } else {
              setIsEditMode(true);
              collapseToOverview();
            }
          }}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{
            backgroundColor: isEditMode ? (isDark ? '#374151' : '#e5e7eb') : 'transparent',
            color: isEditMode ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}
        >
          {isEditMode ? '完成' : '编辑'}
        </button>
      </div>

      {/* ====== MAIN BUBBLE AREA ====== */}
      <div
        ref={bubbleContainerRef}
        className="flex-1 relative overflow-hidden"
        style={{ minHeight: '300px' }}
        onClick={(e) => {
          // Tap empty area to collapse
          if (e.target === e.currentTarget && expandedParentId) {
            collapseToOverview();
          }
        }}
      >
        {expandedParentId ? (
          /* ====== EXPANDED VIEW (subcategory pills) ====== */
          <div className="flex flex-col items-center pt-4 px-4 h-full">
            {/* Faded background bubbles */}
            {bubblePositions.map((pos, i) => {
              const parent = parents[i];
              if (!parent) return null;
              const isExpanded = parent.id === expandedParentId;
              const [c1, c2] = getBubbleColors(parent.name);
              const color1 = isDark ? darkenColor(c1, 0.15) : c1;
              const color2 = isDark ? darkenColor(c2, 0.15) : c2;

              if (isExpanded) return null; // Render expanded one separately

              return (
                <div
                  key={parent.id}
                  className="absolute rounded-full flex items-center justify-center transition-all duration-500"
                  style={{
                    width: pos.size * 0.8,
                    height: pos.size * 0.8,
                    left: pos.x - (pos.size * 0.8) / 2,
                    top: pos.y - (pos.size * 0.8) / 2,
                    background: `radial-gradient(circle at 35% 35%, ${color1}, ${color2})`,
                    opacity: 0.15,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                  }}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span style={{ fontSize: '18px' }}>{parent.icon}</span>
                    <span
                      className="font-medium"
                      style={{
                        fontSize: '11px',
                        color: isDark ? '#E0E0E0' : '#4A4A4A',
                      }}
                    >
                      {parent.name}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Enlarged expanded bubble */}
            {expandedParent && (() => {
              const [c1, c2] = getBubbleColors(expandedParent.name);
              const color1 = isDark ? darkenColor(c1, 0.15) : c1;
              const color2 = isDark ? darkenColor(c2, 0.15) : c2;
              return (
                <div
                  className="rounded-full flex items-center justify-center transition-all duration-500 flex-shrink-0"
                  style={{
                    width: 130,
                    height: 130,
                    background: `radial-gradient(circle at 35% 35%, ${color1}, ${color2})`,
                    boxShadow: isDark
                      ? '0 8px 40px rgba(0,0,0,0.4)'
                      : '0 8px 40px rgba(0,0,0,0.12)',
                  }}
                >
                  <div className="flex flex-col items-center gap-1">
                    <span style={{ fontSize: '28px' }}>{expandedParent.icon}</span>
                    <span
                      className="font-semibold"
                      style={{
                        fontSize: '16px',
                        color: isDark ? '#E0E0E0' : '#4A4A4A',
                      }}
                    >
                      {expandedParent.name}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Breadcrumb */}
            {breadcrumbLabels.length > 1 && (
              <div className="flex items-center gap-1.5 mt-3 flex-wrap justify-center">
                {breadcrumbLabels.map((label, idx) => (
                  <span key={idx} className="flex items-center gap-1.5">
                    {idx > 0 && (
                      <span className="text-xs text-[var(--text-secondary)]">›</span>
                    )}
                    <button
                      onClick={() => handleBreadcrumbClick(idx)}
                      className="text-xs transition-colors"
                      style={{
                        color:
                          idx === breadcrumbLabels.length - 1
                            ? 'var(--text-primary)'
                            : 'var(--text-secondary)',
                        fontWeight: idx === breadcrumbLabels.length - 1 ? 600 : 400,
                      }}
                    >
                      {label}
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Subcategory pills */}
            <div className="flex flex-wrap justify-center gap-2 mt-5 px-2">
              {currentChildren.map((child, idx) => {
                const [c1] = getBubbleColors(expandedParent?.name ?? '');
                const pillBg = isDark
                  ? darkenColor(mixWithWhite(c1, 0.3), 0.3)
                  : mixWithWhite(c1, 0.4);
                const pillText = isDark
                  ? mixWithWhite(c1, 0.3)
                  : darkenForText(c1);
                const isActiveChild = activeEntry?.category_id === child.id;
                const isSecondaryChild = secondaryEntry?.category_id === child.id;
                const isLeafNode = isLeaf(child.id);

                return (
                  <button
                    key={child.id}
                    onClick={(e) => {
                      if (longPressTriggered.current) {
                        e.preventDefault();
                        return;
                      }
                      handlePillClick(child);
                    }}
                    onTouchStart={() => {
                      if (isLeafNode) handleTouchStart(child.id);
                    }}
                    onTouchEnd={() => {
                      if (isLeafNode) handleTouchEnd();
                    }}
                    onMouseDown={() => {
                      if (isLeafNode) handleTouchStart(child.id);
                    }}
                    onMouseUp={() => {
                      if (isLeafNode) handleTouchEnd();
                    }}
                    onMouseLeave={() => {
                      if (isLeafNode) handleTouchEnd();
                    }}
                    className="rounded-full active:scale-[0.92] transition-transform duration-150 relative"
                    style={{
                      padding: '10px 16px',
                      fontSize: '15px',
                      backgroundColor: isActiveChild
                        ? (isDark ? darkenColor(c1, 0.1) : c1)
                        : pillBg,
                      color: isActiveChild ? '#fff' : pillText,
                      animation: `pillAppear 0.3s ease-out ${idx * 0.05}s both`,
                      border: isSecondaryChild
                        ? `2px dashed ${c1}`
                        : isActiveChild
                        ? `2px solid ${isDark ? darkenColor(c1, 0.1) : c1}`
                        : '2px solid transparent',
                    }}
                  >
                    {child.name}
                    {!isLeafNode && (
                      <span className="ml-1 opacity-50">›</span>
                    )}
                    {isActiveChild && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-white animate-pulse" />
                    )}
                    {isSecondaryChild && (
                      <span
                        className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse"
                        style={{ backgroundColor: c1 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {currentChildren.length === 0 && (
              <div className="text-sm text-[var(--text-secondary)] mt-8">
                暂无子分类
              </div>
            )}
          </div>
        ) : (
          /* ====== BUBBLE OVERVIEW ====== */
          <>
            {bubblePositions.map((pos, i) => {
              const parent = parents[i];
              if (!parent) return null;
              const [c1, c2] = getBubbleColors(parent.name);
              const color1 = isDark ? darkenColor(c1, 0.15) : c1;
              const color2 = isDark ? darkenColor(c2, 0.15) : c2;
              const animIdx = i % 5;
              const isActiveBubble = activeParentId === parent.id;
              const isSecondaryBubble = secondaryParentId === parent.id;

              return (
                <div
                  key={parent.id}
                  className="absolute rounded-full flex items-center justify-center cursor-pointer active:scale-[0.92] transition-transform duration-150 select-none"
                  style={{
                    width: pos.size,
                    height: pos.size,
                    left: pos.x - pos.size / 2,
                    top: pos.y - pos.size / 2,
                    background: `radial-gradient(circle at 35% 35%, ${color1}, ${color2})`,
                    boxShadow: isActiveBubble
                      ? undefined
                      : isSecondaryBubble
                      ? undefined
                      : isDark
                      ? '0 4px 24px rgba(0,0,0,0.35)'
                      : '0 4px 24px rgba(0,0,0,0.08)',
                    animation: isEditMode
                      ? 'none'
                      : isActiveBubble
                      ? 'glowPulse 2s ease-in-out infinite'
                      : isSecondaryBubble
                      ? 'glowPulseDashed 2.5s ease-in-out infinite'
                      : `bubbleFloat${animIdx} ${3 + (i % 3)}s ease-in-out ${i * 0.4}s infinite`,
                    border: isSecondaryBubble
                      ? '3px dashed rgba(251,191,36,0.6)'
                      : 'none',
                  }}
                  onClick={() => handleBubbleClick(parent.id)}
                >
                  <div className="flex flex-col items-center gap-0.5 pointer-events-none">
                    <span style={{ fontSize: '24px' }}>{parent.icon}</span>
                    <span
                      className="font-medium"
                      style={{
                        fontSize: '14px',
                        color: isDark ? '#E0E0E0' : '#4A4A4A',
                      }}
                    >
                      {parent.name}
                    </span>
                  </div>

                  {/* Edit mode gear icon */}
                  {isEditMode && (
                    <div
                      className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{
                        backgroundColor: isDark ? '#374151' : '#e5e7eb',
                        fontSize: '12px',
                      }}
                    >
                      ⚙
                    </div>
                  )}
                </div>
              );
            })}

            {/* Edit mode: add category button */}
            {isEditMode && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                <button
                  onClick={() => {
                    setEditingParentId(null);
                    setNewCatParentId('');
                    setShowCategoryEditor(true);
                  }}
                  className="px-4 py-2 rounded-full text-sm transition-colors"
                  style={{
                    backgroundColor: isDark ? '#374151' : '#e5e7eb',
                    color: 'var(--text-primary)',
                  }}
                >
                  + 添加大类
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ====== TODAY SUMMARY BAR ====== */}
      <div
        className="px-4 py-2 border-t border-[var(--border)]"
        style={{
          backgroundColor: isDark ? '#1a1a1a' : '#f9fafb',
          minHeight: '32px',
        }}
      >
        {totalSeconds > 0 ? (
          <>
            <div className="flex h-2.5 rounded-full overflow-hidden mb-1">
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
            <div className="text-xs text-[var(--text-secondary)] text-right">
              今日 {formatDuration(totalSeconds)}
            </div>
          </>
        ) : (
          <div className="flex items-center h-full">
            <div className="flex-1 h-2.5 rounded-full bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-[var(--text-secondary)] ml-3">今日暂无记录</span>
          </div>
        )}
      </div>

      {/* ====== TASK ACTION SHEET ====== */}
      {showTaskActionSheet && pendingLeafCategoryId && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"
          onClick={() => {
            setShowTaskActionSheet(false);
            setPendingLeafCategoryId(null);
          }}
        >
          <div
            className="bg-[var(--bg-card)] rounded-t-2xl p-5 w-full max-w-[430px] space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center text-sm text-[var(--text-secondary)] mb-2">
              {(() => {
                const cat = getCategoryById(pendingLeafCategoryId);
                return cat?.name ?? '';
              })()}
            </div>
            <button
              onClick={handleTaskActionSwitch}
              className="w-full py-3 rounded-xl text-sm font-medium transition-colors"
              style={{
                backgroundColor: isDark ? '#374151' : '#f3f4f6',
                color: 'var(--text-primary)',
              }}
            >
              切换到此任务（停止当前）
            </button>
            {!secondaryEntry && (
              <button
                onClick={handleTaskActionSecondary}
                className="w-full py-3 rounded-xl text-sm font-medium transition-colors"
                style={{
                  backgroundColor: isDark ? '#374151' : '#f3f4f6',
                  color: 'var(--text-primary)',
                }}
              >
                作为副任务同时进行
              </button>
            )}
            <button
              onClick={() => {
                setShowTaskActionSheet(false);
                setPendingLeafCategoryId(null);
              }}
              className="w-full py-2 text-sm text-[var(--text-secondary)]"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* ====== SECONDARY TASK POPUP ====== */}
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

      {/* ====== PROJECT SELECTION BOTTOM SHEET ====== */}
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
            <div className="text-center text-sm font-medium text-[var(--text-primary)] mb-3">
              选择项目
            </div>
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

      {/* ====== PROJECT MANAGER MODAL ====== */}
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
              <div className="text-sm text-[var(--text-secondary)] text-center py-4">
                暂无活跃项目
              </div>
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

      {/* ====== CATEGORY EDITOR MODAL ====== */}
      {showCategoryEditor && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => {
            setShowCategoryEditor(false);
            setEditingParentId(null);
          }}
        >
          <div
            className="bg-[var(--bg-card)] rounded-2xl p-5 mx-4 w-full max-w-sm max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-[var(--text-primary)]">分类管理</h3>
              <button
                onClick={() => {
                  setShowCategoryEditor(false);
                  setEditingParentId(null);
                }}
                className="text-[var(--text-secondary)] text-lg"
              >
                ✕
              </button>
            </div>

            {(editingParentId
              ? groups.filter((g) => g.parent.id === editingParentId)
              : groups
            ).map((group) => (
              <div key={group.parent.id} className="mb-3">
                <div className="flex items-center justify-between py-1">
                  {editingCatId === group.parent.id ? (
                    <input
                      type="text"
                      value={editingCatName}
                      onChange={(e) => setEditingCatName(e.target.value)}
                      onBlur={() => handleRenameCategory(group.parent.id, editingCatName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')
                          handleRenameCategory(group.parent.id, editingCatName);
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
                  <div
                    key={child.id}
                    className="flex items-center justify-between pl-4 py-1"
                  >
                    {editingCatId === child.id ? (
                      <input
                        type="text"
                        value={editingCatName}
                        onChange={(e) => setEditingCatName(e.target.value)}
                        onBlur={() => handleRenameCategory(child.id, editingCatName)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter')
                            handleRenameCategory(child.id, editingCatName);
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
                      newCatColor === c
                        ? 'border-gray-800 scale-110'
                        : 'border-transparent'
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
