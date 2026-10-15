import { useState, type FormEvent } from "react";

export default function TokenGate({ onSubmit, notice }: { onSubmit: (token: string) => void; notice: string | null }) {
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = value.trim();
    if (t) onSubmit(t);
  };
  return (
    <div className="mx-auto mt-10 max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Enter the server's ADMIN_TOKEN. It is kept for this browser tab only and cleared when the tab closes.
      </p>
      {notice && (
        <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {notice}
        </p>
      )}
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Admin token</span>
          <input
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={!value.trim()}
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
