import { useLocation, useNavigate } from 'react-router-dom';

const tabs = [
  { path: '/', label: '计时', icon: '⏱' },
  { path: '/plan', label: '计划', icon: '📋' },
  { path: '/habits', label: '习惯', icon: '🎯' },
  { path: '/insights', label: '统计', icon: '📊' },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white border-t border-gray-200 z-50">
      <div className="flex justify-around items-center h-14">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`flex flex-col items-center gap-0.5 py-1 px-3 text-xs transition-colors ${
                isActive ? 'text-gray-900 font-medium' : 'text-gray-400'
              }`}
            >
              <span className="text-lg">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
