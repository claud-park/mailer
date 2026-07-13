import { useEffect } from 'react';
import { useMailStore } from './store/mail';
import { useKeyboard } from './hooks/useKeyboard';
import { useThreads } from './hooks/useThreads';
import { CommandPalette } from './components/CommandPalette';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { ThreadList } from './components/ThreadList';
import { ThreadView } from './components/ThreadView';
import { Compose } from './components/Compose';
import { SnoozePicker } from './components/SnoozePicker';
import { AgendaPanel } from './components/AgendaPanel';
import { EventComposer } from './components/EventComposer';
import { FollowupPicker } from './components/FollowupPicker';
import { LabelPicker } from './components/LabelPicker';
import { SplitSettings } from './components/SplitSettings';
import { SnippetsManager } from './components/SnippetsManager';
import { Login } from './components/Login';
import { Toasts } from './components/Toasts';
import { CoachToastHost } from './components/CoachToastHost';
import { CheatSheet } from './components/CheatSheet';
import { StatsPanel } from './components/StatsPanel';
import { Tutorial } from './components/Tutorial';
import { LatencyHud } from './components/LatencyHud';

function Shell() {
  const activeThreadId = useMailStore((s) => s.activeThreadId);
  const composeOpen = useMailStore((s) => !!s.composeInit);
  useKeyboard();
  useThreads();

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Toolbar />
          <div className="flex min-h-0 flex-1">
            <ThreadList />
            {activeThreadId ? <ThreadView /> : null}
          </div>
        </main>
      </div>
      {composeOpen && <Compose />}
      <SnoozePicker />
      <AgendaPanel />
      <EventComposer />
      <FollowupPicker />
      <LabelPicker />
      <SplitSettings />
      <SnippetsManager />
      <CheatSheet />
      <StatsPanel />
      <Tutorial />
      <CoachToastHost />
      <Toasts />
      <LatencyHud />
    </div>
  );
}

export default function App() {
  const account = useMailStore((s) => s.account);
  const accountLoading = useMailStore((s) => s.accountLoading);
  const init = useMailStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  if (accountLoading) {
    return (
      <div className="app-drag flex h-full items-center justify-center text-text-muted">
        <span className="text-2xl">🪷</span>
      </div>
    );
  }
  if (!account) return <Login />;

  return (
    <CommandPalette>
      <Shell />
    </CommandPalette>
  );
}
