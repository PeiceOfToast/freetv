import { useMemo, useState, type ReactNode } from "react";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Category, Country, Language } from "@/lib/api";
import { PLAYABLE_OPTIONS, QUALITY_OPTIONS, type BrowseState } from "./state";
import type { RefData } from "./useRefData";

export interface FilterPanelProps {
  idPrefix: string;
  state: BrowseState;
  refData: RefData | null;
  refError: string | null;
  onRetryRef: () => void;
  favoriteCount: number;
  onChange: (patch: Partial<BrowseState>) => void;
  onClearAll: () => void;
  activeCount: number;
}

const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const LIST_PREVIEW = 8;

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="border-t border-zinc-200/80 py-4 first:border-t-0 first:pt-0 dark:border-zinc-800/80">
      <h2 id={id} className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Toggle({ id, label, description, checked, onChange, children }: {
  id: string; label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; children?: ReactNode;
}) {
  return (
    <div className="py-1.5">
      <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-3 pointer-coarse:min-h-11">
        <span className="min-w-0">
          <span className="block text-sm text-zinc-800 dark:text-zinc-200">{label}</span>
          {description && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{description}</span>}
        </span>
        <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center">
          <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
          <span aria-hidden="true" className="absolute inset-0 rounded-full bg-zinc-300 transition-colors peer-checked:bg-zinc-900 peer-focus-visible:ring-2 peer-focus-visible:ring-zinc-500 dark:bg-zinc-700 dark:peer-checked:bg-zinc-100" />
          <span aria-hidden="true" className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4 dark:bg-zinc-900 dark:peer-checked:bg-zinc-900" />
        </span>
      </label>
      {children}
    </div>
  );
}

/** Searchable multi-select list with checkboxes; selected items are pinned to the top. */
function CheckList<T extends { id: string; label: string; count: number; prefix?: string }>({
  items, selected, onToggle, placeholder, label,
}: { items: T[]; selected: string[]; onToggle: (id: string) => void; placeholder: string; label: string }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.id.toLowerCase() === q) : items;
    const sel = matches.filter((i) => selected.includes(i.id));
    const rest = matches.filter((i) => !selected.includes(i.id));
    return [...sel, ...rest];
  }, [items, selected, query]);
  const limited = !query.trim() && !expanded;
  const shown = limited ? visible.slice(0, LIST_PREVIEW) : visible;

  return (
    <div className="flex flex-col gap-2">
      {items.length > LIST_PREVIEW && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={`Search ${label}`}
          className="h-8 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      )}
      <ul className="flex flex-col" aria-label={label}>
        {shown.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-sm pointer-coarse:min-h-11 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/60">
              <input
                type="checkbox"
                checked={selected.includes(i.id)}
                onChange={() => onToggle(i.id)}
                className="h-3.5 w-3.5 shrink-0 accent-zinc-900 dark:accent-zinc-100"
              />
              {i.prefix && <span aria-hidden="true" className="w-5 text-center">{i.prefix}</span>}
              <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">{i.label}</span>
              <span className="tabular-nums text-xs text-zinc-400 dark:text-zinc-500">{i.count}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-1.5 py-1 text-sm text-zinc-500">No matches</li>}
      </ul>
      {limited && visible.length > LIST_PREVIEW && (
        <button type="button" onClick={() => setExpanded(true)} className="self-start px-1.5 text-xs font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Show all {visible.length}
        </button>
      )}
      {expanded && !query.trim() && (
        <button type="button" onClick={() => setExpanded(false)} className="self-start px-1.5 text-xs font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Show fewer
        </button>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
    </div>
  );
}

export function FilterPanel({ idPrefix: idp, state: s, refData, refError, onRetryRef, favoriteCount, onChange, onClearAll, activeCount }: FilterPanelProps) {
  const categories: (Category & { label: string; count: number })[] = useMemo(
    () => (refData?.categories ?? []).map((c) => ({ ...c, label: c.name, count: c.channelCount })),
    [refData],
  );
  const countries = useMemo(
    () => (refData?.countries ?? []).map((c: Country) => ({ id: c.code, label: c.name, count: c.channelCount, prefix: c.flag ?? undefined })),
    [refData],
  );
  const languages = useMemo(
    () => (refData?.languages ?? []).map((l: Language) => ({ id: l.code, label: l.name, count: l.channelCount })),
    [refData],
  );

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 id={`${idp}-heading`} className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Filters</h2>
        <Button variant="ghost" size="sm" onClick={onClearAll} disabled={activeCount === 0}>
          Clear all{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>

      <Section id={`${idp}-categories`} title="Categories">
        {refError && !refData ? (
          <RefError onRetry={onRetryRef} />
        ) : !refData ? (
          <div className="flex flex-wrap gap-1.5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-6 w-16 rounded-full" />)}</div>
        ) : (
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${idp}-categories`}>
            {categories.map((c) => (
              <Chip
                key={c.id}
                active={s.category.includes(c.id)}
                count={c.count}
                onClick={() => onChange({ category: toggleIn(s.category, c.id) })}
                className="capitalize"
              >
                {c.label}
              </Chip>
            ))}
          </div>
        )}
      </Section>

      <Section id={`${idp}-quality`} title="Minimum quality">
        <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${idp}-quality`}>
          {QUALITY_OPTIONS.map((o) => (
            <Chip key={o.label} active={s.quality === o.value} onClick={() => onChange({ quality: o.value })}>
              {o.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section id={`${idp}-playable`} title="Plays in">
        <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${idp}-playable`}>
          {PLAYABLE_OPTIONS.map((o) => (
            <Chip key={o.value} active={s.playable === o.value} onClick={() => onChange({ playable: o.value })}>
              {o.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          Browser: plays in this browser. App: needs VLC or a TV app.
        </p>
      </Section>

      <Section id={`${idp}-countries`} title="Countries">
        {refError && !refData ? <RefError onRetry={onRetryRef} /> : !refData ? <ListSkeleton /> : (
          <CheckList
            items={countries}
            selected={s.country}
            label="countries"
            placeholder="Find a country…"
            onToggle={(id) => onChange({ country: toggleIn(s.country, id) })}
          />
        )}
      </Section>

      <Section id={`${idp}-languages`} title="Languages">
        {refError && !refData ? <RefError onRetry={onRetryRef} /> : !refData ? <ListSkeleton /> : (
          <CheckList
            items={languages}
            selected={s.language}
            label="languages"
            placeholder="Find a language…"
            onToggle={(id) => onChange({ language: toggleIn(s.language, id) })}
          />
        )}
      </Section>

      <Section id={`${idp}-options`} title="Show">
        <Toggle id={`${idp}-hasstream`} label="Only with streams" description="Hide channels with no playable stream." checked={s.hasStream} onChange={(v) => onChange({ hasStream: v })} />
        <Toggle id={`${idp}-online`} label="Only online" description="Channels whose last health check passed." checked={s.online} onChange={(v) => onChange({ online: v })} />
        <Toggle id={`${idp}-favorites`} label={`Favorites only${favoriteCount ? ` (${favoriteCount})` : ""}`} checked={s.favorites} onChange={(v) => onChange({ favorites: v })} />
        <Toggle id={`${idp}-nsfw`} label="Show adult channels" checked={s.nsfw} onChange={(v) => onChange({ nsfw: v })}>
          {s.nsfw && (
            <p role="note" className="mt-1.5 rounded-lg border border-amber-300/70 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              Adult channels are included. FreeTV does not verify their content.
            </p>
          )}
        </Toggle>
      </Section>
    </div>
  );
}

function RefError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-zinc-500">
      <span>Couldn’t load filter options.</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>
    </div>
  );
}
