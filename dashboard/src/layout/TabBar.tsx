import { Link } from 'react-router';

export type TabId = 'state' | 'settings' | 'usage' | 'plans';

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="flex items-center gap-1 bg-white/5 rounded-full p-1">
      {([['state', '/', 'State'], ['settings', '/settings', 'Config'], ['usage', '/usage', 'Usage'], ['plans', '/plans', 'Plans']] as const).map(
        ([id, path, label]) => (
          <Link
            key={id}
            to={path}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) return;
              e.preventDefault();
              onTabChange(id);
            }}
            className={`px-4 py-1.5 rounded-full text-sm no-underline transition-all duration-200 ${
              activeTab === id
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-text-secondary hover:text-white hover:bg-white/5'
            }`}
          >
            {label}
          </Link>
        ),
      )}
    </div>
  );
}
