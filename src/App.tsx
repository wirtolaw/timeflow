import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { getUserId, setUserId } from './lib/supabase';
import { seedCategories } from './lib/seed';
import BottomNav from './components/BottomNav';
import Timer from './pages/Timer';
import Plan from './pages/Plan';
import Habits from './pages/Habits';
import Insights from './pages/Insights';
import Settings from './pages/Settings';

type ThemeMode = 'light' | 'dark' | 'system';

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'dark') {
    root.classList.add('dark');
  } else if (mode === 'light') {
    root.classList.remove('dark');
  } else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}

function Setup({ onComplete }: { onComplete: () => void }) {
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const trimmed = nickname.trim();
    if (!trimmed) return;
    setLoading(true);
    setUserId(trimmed);
    await seedCategories(trimmed);
    setLoading(false);
    onComplete();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-secondary)] px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-[var(--text-primary)] mb-2">TimeFlow</h1>
          <p className="text-[var(--text-secondary)] text-sm">时间追踪，从这里开始</p>
        </div>
        <div className="space-y-4">
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="输入你的昵称"
            className="w-full px-4 py-3 rounded-xl border border-[var(--border)] text-center text-lg focus:outline-none focus:ring-2 focus:ring-gray-300 bg-[var(--bg-card)] text-[var(--text-primary)]"
            autoFocus
          />
          <button
            onClick={handleSubmit}
            disabled={!nickname.trim() || loading}
            className="w-full py-3 rounded-xl bg-gray-800 text-white font-medium disabled:opacity-40 transition-opacity"
          >
            {loading ? '初始化中...' : '开始使用'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [userId, setUserIdState] = useState<string | null>(getUserId());

  useEffect(() => {
    setUserIdState(getUserId());
  }, []);

  // Apply theme on mount and listen for system changes
  useEffect(() => {
    const theme = (localStorage.getItem('tf_theme') as ThemeMode) || 'system';
    applyTheme(theme);

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const currentTheme = (localStorage.getItem('tf_theme') as ThemeMode) || 'system';
      if (currentTheme === 'system') {
        applyTheme('system');
      }
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  if (!userId) {
    return <Setup onComplete={() => setUserIdState(getUserId())} />;
  }

  return (
    <HashRouter>
      <div className="max-w-[430px] mx-auto min-h-screen bg-[var(--bg-secondary)] relative">
        <Routes>
          <Route path="/" element={<Timer />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/habits" element={<Habits />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
        <BottomNav />
      </div>
    </HashRouter>
  );
}
