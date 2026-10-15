// Remote-friendly keyboard: a grid of focusable keys. No <input>, so the TV's native IME never opens.
const ROWS: string[][] = [
  "ABCDEFGHIJ".split(""),
  "KLMNOPQRST".split(""),
  "UVWXYZ0123".split(""),
  "456789".split(""),
];

export function OnScreenKeyboard({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const add = (ch: string) => onChange(value + ch.toLowerCase());
  return (
    <div>
      <div className="tv-query" aria-live="polite" data-testid="tv-query">
        {value || <span className="tv-small">Type a channel name…</span>}
      </div>
      <div className="tv-kb" role="group" aria-label="Keyboard">
        {ROWS.flatMap((row) => row).map((ch) => (
          <button key={ch} type="button" data-nav tabIndex={0} className="tv-key" onClick={() => add(ch)}>
            {ch}
          </button>
        ))}
        <button type="button" data-nav tabIndex={0} className="tv-key tv-key-wider" onClick={() => add(" ")}>
          Space
        </button>
        <button type="button" data-nav tabIndex={0} className="tv-key tv-key-wide" onClick={() => onChange(value.slice(0, -1))}>
          ⌫ Back
        </button>
        <button type="button" data-nav tabIndex={0} className="tv-key tv-key-wide" onClick={() => onChange("")}>
          Clear
        </button>
      </div>
    </div>
  );
}

export default OnScreenKeyboard;
