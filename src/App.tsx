import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { getUserId, setUserId } from './lib/supabase';
import { seedCategories } from './lib/seed';
import BottomNav from './components/BottomNav';
import Timer from './pages/Timer';
import Plan from './pages/Plan';
import Habits from './pages/Habits';
import Insights from './pages/Insights';

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-gray-800 mb-2">TimeFlow</h1>
          <p className="text-gray-500 text-sm">时间追踪，从这里开始</p>
        </div>
        <div className="space-y-4">
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="输入你的昵称"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-center text-lg focus:outline-none focus:ring-2 focus:ring-gray-300 bg-white"
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

  if (!userId) {
    return <Setup onComplete={() => setUserIdState(getUserId())} />;
  }

  return (
    <HashRouter>
      <div className="max-w-[430px] mx-auto min-h-screen bg-gray-50 relative">
        <Routes>
          <Route path="/" element={<Timer />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/habits" element={<Habits />} />
          <Route path="/insights" element={<Insights />} />
        </Routes>
        <BottomNav />
      </div>
    </HashRouter>
  );
}
