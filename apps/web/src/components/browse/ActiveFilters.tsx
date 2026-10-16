import { RemovableChip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import type { RefData } from "./useRefData";
import { QUALITY_OPTIONS, hasActiveFilters, type BrowseState } from "./state";

export interface ActiveFiltersProps {
  state: BrowseState;
  refData: RefData | null;
  onChange: (patch: Partial<BrowseState>) => void;
  onClearAll: () => void;
}

const without = (list: string[], v: string) => list.filter((x) => x !== v);

/** Removable chips for every active filter. Renders nothing when no filter is set. */
export function ActiveFilters({ state: s, refData, onChange, onClearAll }: ActiveFiltersProps) {
  if (!hasActiveFilters(s)) return null;
  const chips: { key: string; label: string; onRemove: () => void }[] = [];

  if (s.q) chips.push({ key: "q", label: `Search: “${s.q}”`, onRemove: () => onChange({ q: "" }) });
  for (const id of s.category) {
    const name = refData?.categories.find((c) => c.id === id)?.name ?? id;
    chips.push({ key: `c:${id}`, label: name, onRemove: () => onChange({ category: without(s.category, id) }) });
  }
  for (const code of s.country) {
    const c = refData?.countries.find((x) => x.code === code);
    chips.push({
      key: `k:${code}`,
      label: `${c?.flag ? `${c.flag} ` : ""}${c?.name ?? code}`,
      onRemove: () => onChange({ country: without(s.country, code) }),
    });
  }
  for (const code of s.language) {
    const name = refData?.languages.find((l) => l.code === code)?.name ?? code;
    chips.push({ key: `l:${code}`, label: name, onRemove: () => onChange({ language: without(s.language, code) }) });
  }
  if (s.playable !== "any") {
    chips.push({ key: "playable", label: `Plays in: ${s.playable === "browser" ? "Browser" : "App"}`, onRemove: () => onChange({ playable: "any" }) });
  }
  if (s.quality) {
    const label = QUALITY_OPTIONS.find((o) => o.value === s.quality)?.label ?? s.quality;
    chips.push({ key: "quality", label: `Quality: ${label}`, onRemove: () => onChange({ quality: "" }) });
  }
  if (!s.hasStream) chips.push({ key: "hasStream", label: "Including channels without streams", onRemove: () => onChange({ hasStream: true }) });
  if (s.online) chips.push({ key: "online", label: "Online only", onRemove: () => onChange({ online: false }) });
  if (s.nsfw) chips.push({ key: "nsfw", label: "Adult content shown", onRemove: () => onChange({ nsfw: false }) });
  if (s.favorites) chips.push({ key: "favorites", label: "Favorites", onRemove: () => onChange({ favorites: false }) });

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      {chips.map((c) => (
        <RemovableChip key={c.key} label={c.label} onRemove={c.onRemove} />
      ))}
      <Button variant="ghost" size="sm" onClick={onClearAll} className="ml-1">
        Clear all
      </Button>
    </div>
  );
}
