import { Send } from 'lucide-react';
import { signOut } from '@/lib/auth';
import { ProjectSelector } from './ProjectSelector';
import { TabBar } from './TabBar';
import type { TabId } from './TabBar';

interface TopBarProps {
  onProjectSelect?: (projectId: string) => void;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TopBar({ onProjectSelect, activeTab, onTabChange }: TopBarProps) {
  const handleSignOut = () => {
    signOut();
    window.location.href = '/login';
  };

  return (
    <header className="grid grid-cols-3 items-center border-b border-border px-6">
      {/* Left group */}
      <div className="flex items-center gap-3 py-3">
        <Send size={36} color="#3399FF" strokeWidth={0.5} />
        <span className="font-semibold font-mono text-foreground">SkyState</span>
        <span className="text-text-dim">/</span>
        <ProjectSelector onProjectSelect={onProjectSelect} />
      </div>

      {/* Center group — tabs */}
      <div className="flex justify-center">
        <TabBar activeTab={activeTab} onTabChange={onTabChange} />
      </div>

      {/* Right group */}
      <div className="flex items-center justify-end py-3">
        <button
          onClick={handleSignOut}
          className="text-sm text-text-muted hover:text-foreground transition-colors cursor-pointer"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
