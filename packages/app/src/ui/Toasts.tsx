import { useToasts } from '../lib/toasts';
import type { JSX } from 'react';

export function Toasts(): JSX.Element {
  const items = useToasts();
  return (
    <div id="toasts">
      {items.map((t) => (
        <div key={t.id} className="toast" data-sev={t.severity} role={t.severity === 'error' ? 'alert' : 'status'}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
