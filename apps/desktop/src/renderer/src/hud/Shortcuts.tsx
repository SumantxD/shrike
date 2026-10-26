import { useEffect, useRef } from "react";
import { Keyboard, X } from "lucide-react";
import { useUi } from "../stores/ui.ts";
import { IconButton, Kbd } from "../components/ui.tsx";
import { keyLabel, SHORTCUTS } from "./logic.ts";

// H17: ? lists every key, grouped. The rows come from SHORTCUTS in logic.ts, so they can't drift from the keymap. ? or Esc closes.

export function Shortcuts() {
  const open = useUi((s) => s.help);
  const card = useRef<HTMLElement>(null);

  // Focus moves into the card and goes back where it was on close.
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    card.current?.focus();
    return () => back?.focus();
  }, [open]);

  if (!open) return null;
  const close = () => useUi.setState({ help: false });

  return (
    <div className="absolute inset-0 z-[46] bg-[color-mix(in_srgb,var(--void)_60%,transparent)]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          // Close is the only control, so Tab stays on the card.
          if (e.key !== "Tab") return;
          e.preventDefault();
          const btn = card.current?.querySelector("button");
          (document.activeElement === btn ? card.current : btn)?.focus();
        }}
        className="glass solid rise absolute top-14 left-1/2 flex max-h-[calc(100%-72px)] w-[min(560px,92%)] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--r-card)] shadow-[0_30px_80px_var(--void)] outline-none"
      >
        <header className="flex items-center gap-2.5 border-b border-hair py-3 pr-2 pl-4">
          <Keyboard size={13} className="text-signal" aria-hidden />
          <h2 id="shortcuts-title" className="lbl m-0 flex-1 text-ink">
            Keyboard shortcuts
          </h2>
          <IconButton label="Close" onClick={close}>
            <X size={13} />
          </IconButton>
        </header>
        <div className="grid min-h-0 grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-6 gap-y-4 overflow-auto px-4 py-3">
          {SHORTCUTS.map((g) => (
            <section key={g.group} aria-labelledby={`shortcuts-${g.group}`}>
              <h3 id={`shortcuts-${g.group}`} className="micro m-0 mb-1.5 text-[9.5px] text-faint">
                {g.group}
              </h3>
              <dl className="m-0 grid gap-1">
                {g.rows.map((r) => (
                  <div key={r.keys.join(" ")} className="flex items-center gap-3">
                    <dt className="flex w-[84px] shrink-0 gap-1">
                      {r.keys.map((k) => (
                        <Kbd key={k}>{keyLabel(k)}</Kbd>
                      ))}
                    </dt>
                    <dd className="m-0 min-w-0 text-[12.5px] text-dim">{r.what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="micro m-0 border-t border-hair px-4 py-2 text-[9.5px] text-faint" aria-hidden>
          ? or Esc close · Keys never fire while you type
        </p>
      </section>
    </div>
  );
}
