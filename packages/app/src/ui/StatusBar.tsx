import { useStatus } from '../lib/status';
import type { JSX } from 'react';
import { useUi } from '../lib/store';

export function StatusBar({ inline = false }: { inline?: boolean }): JSX.Element {
  const { text, engine } = useStatus();
  const ui = useUi();
  // Mobile topbar variant: the fixed footer would cover the bottom action
  // bar, so status rides inline in the slim topbar instead (single instance
  // either way — setStatus targets #status-text exactly once).
  if (inline) {
    return (
      <span className="status-inline" role="status" title={text}>
        <span id="status-text">{text}</span>
      </span>
    );
  }
  return (
    <footer className="status" id="status" role="status">
      <span className="dot">●</span>
      <span id="status-text">{text}</span>
      <span className="sp" />
      <span className="pill" id="pill-view">{ui.view}</span>
      <span className="pill" id="pill-tool">{ui.tool}</span>
      <span className="pill" id="pill-engine">{engine}</span>
    </footer>
  );
}
