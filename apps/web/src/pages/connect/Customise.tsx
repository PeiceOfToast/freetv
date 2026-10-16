import { useEffect, useMemo, useState } from "react";
import { api, type Category, type Country } from "@/lib/api";
import { FAVORITES_WARN_AT, type QualityChoice } from "./urls";

export interface CustomiseValue {
  countries: string[];
  categories: string[];
  quality: QualityChoice;
  favoritesOnly: boolean;
  allStreams: boolean;
}

export const DEFAULT_CUSTOMISE: CustomiseValue = {
  countries: [],
  categories: [],
  quality: "",
  favoritesOnly: false,
  allStreams: false,
};

const QUALITY_OPTIONS: { value: QualityChoice; label: string }[] = [
  { value: "", label: "Any" },
  { value: "720p", label: "720p or better" },
  { value: "1080p", label: "1080p or better" },
  { value: "2160p", label: "4K (2160p)" },
];

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

const checkRow = "flex min-h-8 items-center gap-2 text-sm pointer-fine:min-h-0";
const checkBox = "h-4 w-4 shrink-0 accent-zinc-900 dark:accent-zinc-100";

export default function Customise({
  value,
  onChange,
  favoriteCount,
}: {
  value: CustomiseValue;
  onChange: (next: CustomiseValue) => void;
  favoriteCount: number;
}) {
  const [countries, setCountries] = useState<Country[] | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([api.countries(), api.categories()]).then(
      ([c, k]) => {
        if (!alive) return;
        setCountries(c);
        setCategories(k);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const visibleCountries = useMemo(() => {
    if (!countries) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [countries, filter]);

  const set = (patch: Partial<CustomiseValue>) => onChange({ ...value, ...patch });
  const noFavorites = favoriteCount === 0;

  return (
    <section aria-labelledby="customise-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="customise-heading" className="text-xl font-semibold">
            Customise
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">The playlist link above updates as you choose.</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_CUSTOMISE)}
          className="inline-flex h-8 items-center rounded-lg border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Reset
        </button>
      </div>

      {failed && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Countries and categories could not be loaded. The playlist still works without these filters.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <fieldset className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Countries {value.countries.length > 0 && `(${value.countries.length} selected)`}
          </legend>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter countries"
            aria-label="Filter countries"
            className="h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="max-h-56 overflow-y-auto pr-1">
            {!countries && !failed && <p className="py-2 text-sm text-zinc-500">Loading countries…</p>}
            {visibleCountries.map((c) => (
              <label key={c.code} className={checkRow}>
                <input
                  type="checkbox"
                  className={checkBox}
                  checked={value.countries.includes(c.code)}
                  onChange={() => set({ countries: toggle(value.countries, c.code) })}
                />
                <span>
                  {c.flag ? `${c.flag} ` : ""}
                  {c.name}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-4">
          <fieldset className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Category</legend>
            <div className="max-h-40 overflow-y-auto pr-1">
              {!categories && !failed && <p className="py-2 text-sm text-zinc-500">Loading categories…</p>}
              {categories?.map((k) => (
                <label key={k.id} className={checkRow}>
                  <input
                    type="checkbox"
                    className={checkBox}
                    checked={value.categories.includes(k.id)}
                    onChange={() => set({ categories: toggle(value.categories, k.id) })}
                  />
                  <span>{k.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Quality</legend>
            {QUALITY_OPTIONS.map((q) => (
              <label key={q.value || "any"} className={checkRow}>
                <input
                  type="radio"
                  name="quality"
                  className={checkBox}
                  checked={value.quality === q.value}
                  onChange={() => set({ quality: q.value })}
                />
                <span>{q.label}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Other</legend>
            <label className={`${checkRow} ${noFavorites ? "opacity-50" : ""}`}>
              <input
                type="checkbox"
                className={checkBox}
                disabled={noFavorites}
                checked={value.favoritesOnly && !noFavorites}
                onChange={(e) => set({ favoritesOnly: e.target.checked })}
              />
              <span>
                My favorites only
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  {noFavorites
                    ? "You have no favorites yet. Star channels on the Channels page to add them."
                    : `${favoriteCount} saved in this browser.`}
                </span>
              </span>
            </label>
            {favoriteCount > FAVORITES_WARN_AT && (
              <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {favoriteCount} favorites make a very long link, and some apps cut long links short. Keep the list under{" "}
                {FAVORITES_WARN_AT} channels, or use the country and category filters instead.
              </p>
            )}
            <label className={checkRow}>
              <input type="checkbox" className={checkBox} checked={value.allStreams} onChange={(e) => set({ allStreams: e.target.checked })} />
              <span>
                Every stream for each channel
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  Adds backup streams as extra entries (streams=all). Off lists one stream per channel.
                </span>
              </span>
            </label>
          </fieldset>
        </div>
      </div>
    </section>
  );
}
