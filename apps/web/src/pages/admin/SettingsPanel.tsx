import { useEffect, useMemo, useState, type FormEvent } from "react";
import { adminApi, AdminApiError, type AdminSettings, type AdminSettingsPatch } from "@/lib/admin-api";
import type { FeaturedApp } from "@/lib/api";
import { FEATURED_APP_LABELS, FEATURED_APP_ORDER } from "../connect/apps";
import { loadSettings } from "../connect/useSettings";

// Field limits from docs/API.md "Settings".
const LIMITS = { siteName: 60, contact: 200, notes: 2000 } as const;

interface Form {
  siteName: string;
  publicUrl: string;
  contact: string;
  notes: string;
  featuredApps: FeaturedApp[];
}
type FieldKey = keyof Form;
type FieldErrors = Partial<Record<FieldKey, string>>;

const FIELD_KEYS: FieldKey[] = ["siteName", "publicUrl", "contact", "notes", "featuredApps"];

function fromAdmin(s: AdminSettings): Form {
  return {
    siteName: s.siteName ?? "",
    publicUrl: s.publicUrl ?? "",
    contact: s.contact ?? "",
    notes: s.notes ?? "",
    featuredApps: FEATURED_APP_ORDER.filter((id) => (s.featuredApps ?? []).includes(id)),
  };
}

function validate(f: Form): FieldErrors {
  const errors: FieldErrors = {};
  if (!f.siteName.trim()) errors.siteName = "Enter a site name.";
  else if (f.siteName.trim().length > LIMITS.siteName) errors.siteName = `Keep the site name to ${LIMITS.siteName} characters or fewer.`;
  const url = f.publicUrl.trim();
  if (url) {
    let ok = false;
    try {
      const u = new URL(url);
      ok = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) errors.publicUrl = "Use a full http:// or https:// address, or leave it empty to use the env default.";
  }
  if (f.contact.length > LIMITS.contact) errors.contact = `Keep the contact to ${LIMITS.contact} characters or fewer.`;
  if (f.notes.length > LIMITS.notes) errors.notes = `Keep the notes to ${LIMITS.notes} characters or fewer.`;
  return errors;
}

/** Maps an API error message to a field when it names one; otherwise it stays a form-level message. */
function fieldFromMessage(msg: string): FieldKey | null {
  const hit = FIELD_KEYS.find((k) => new RegExp(`\\b${k}\\b`).test(msg));
  return hit ?? null;
}

const input =
  "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:bg-zinc-900";
const label = "text-sm font-medium";
const help = "text-xs text-zinc-500 dark:text-zinc-400";
const errorText = "text-xs font-medium text-rose-700 dark:text-rose-400";

export default function SettingsPanel({
  token,
  onAuthError,
  onToast,
}: {
  token: string;
  onAuthError: () => void;
  onToast: (text: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [envUrl, setEnvUrl] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [baseline, setBaseline] = useState<Form | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    adminApi.settingsGet(token).then(
      (s) => {
        if (!alive) return;
        const f = fromAdmin(s);
        setForm(f);
        setBaseline(f);
        setEnvUrl(s.defaults?.publicUrl ?? "");
        setLoading(false);
      },
      (e: unknown) => {
        if (!alive) return;
        if (e instanceof AdminApiError && e.status === 401) {
          onAuthError();
          return;
        }
        setLoadError(e instanceof Error ? e.message : "Could not load settings.");
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [token, reloadKey]);

  const dirty = useMemo(() => (form && baseline ? JSON.stringify(form) !== JSON.stringify(baseline) : false), [form, baseline]);

  if (loading) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Site settings</h2>
        <p role="status" className="pt-3 text-sm text-zinc-500">
          Loading settings…
        </p>
      </section>
    );
  }

  if (!form || !baseline) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Site settings</h2>
        <p role="alert" className="pt-3 text-sm text-amber-900 dark:text-amber-200">
          Could not load settings: {loadError}
        </p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="mt-3 inline-flex h-8 items-center rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          Try again
        </button>
      </section>
    );
  }

  const set = <K extends FieldKey>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setFormError(null);
  };

  const toggleApp = (id: FeaturedApp) => {
    const next = form.featuredApps.includes(id) ? form.featuredApps.filter((a) => a !== id) : [...form.featuredApps, id];
    set("featuredApps", FEATURED_APP_ORDER.filter((a) => next.includes(a)));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const clientErrors = validate(form);
    setErrors(clientErrors);
    setFormError(null);
    if (Object.keys(clientErrors).length > 0) return;

    const patch: AdminSettingsPatch = {
      siteName: form.siteName.trim(),
      publicUrl: form.publicUrl.trim(),
      contact: form.contact.trim(),
      notes: form.notes,
      featuredApps: form.featuredApps,
    };
    setSaving(true);
    try {
      await adminApi.settingsPut(token, patch);
      setBaseline(form);
      onToast("Site settings saved.");
      // Refresh the public settings so the connect page and header see the change.
      loadSettings(true).catch(() => undefined);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        onAuthError();
        return;
      }
      const msg = err instanceof Error ? err.message : "Unknown error.";
      const field = fieldFromMessage(msg);
      if (field) setErrors({ [field]: msg });
      else setFormError(msg);
      onToast(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const defaultLabel = envUrl || "not set";

  return (
    <section aria-labelledby="site-settings-heading" className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 id="site-settings-heading" className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Site settings
          </h2>
          <p className={help}>Shown on the site and on the Use in your app page. Changes take effect on save.</p>
        </div>
        <a
          href="/connect"
          target="_blank"
          rel="noopener"
          className="inline-flex h-8 items-center rounded-lg border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Preview connect page
        </a>
      </header>

      <form onSubmit={(e) => void save(e)} noValidate className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {formError && (
          <p role="alert" className="md:col-span-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {formError}
          </p>
        )}

        <div className="space-y-1.5">
          <label htmlFor="ss-site-name" className={label}>
            Site name
          </label>
          <input
            id="ss-site-name"
            type="text"
            value={form.siteName}
            onChange={(e) => set("siteName", e.target.value)}
            aria-invalid={!!errors.siteName}
            aria-describedby="ss-site-name-help"
            className={input}
          />
          <div id="ss-site-name-help" className="flex justify-between gap-3">
            {errors.siteName ? <span className={errorText}>{errors.siteName}</span> : <span className={help}>Shown in the header and on the connect page.</span>}
            <span className={help}>
              {form.siteName.length}/{LIMITS.siteName}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ss-public-url" className={label}>
            Public URL
          </label>
          <input
            id="ss-public-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={envUrl || "https://tv.example.com"}
            value={form.publicUrl}
            onChange={(e) => set("publicUrl", e.target.value)}
            aria-invalid={!!errors.publicUrl}
            aria-describedby="ss-public-url-help"
            className={`${input} font-mono text-sm`}
          />
          <div id="ss-public-url-help" className="space-y-1">
            {errors.publicUrl && <p className={errorText}>{errors.publicUrl}</p>}
            {form.publicUrl.trim() ? (
              <p className={help}>
                <button
                  type="button"
                  onClick={() => set("publicUrl", "")}
                  className="font-medium underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  Use env default ({defaultLabel})
                </button>
              </p>
            ) : (
              <p className={help}>Using the env default: {defaultLabel}. Used for the playlist and guide links.</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ss-contact" className={label}>
            Contact
          </label>
          <input
            id="ss-contact"
            type="text"
            value={form.contact}
            onChange={(e) => set("contact", e.target.value)}
            aria-invalid={!!errors.contact}
            aria-describedby="ss-contact-help"
            className={input}
          />
          <div id="ss-contact-help" className="flex justify-between gap-3">
            {errors.contact ? <span className={errorText}>{errors.contact}</span> : <span className={help}>An email or link for takedowns and questions.</span>}
            <span className={help}>
              {form.contact.length}/{LIMITS.contact}
            </span>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className={`${label} mb-1.5`}>Featured apps</legend>
          <p className={`${help} -mt-1 mb-2`}>Which setup guides the connect page shows.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FEATURED_APP_ORDER.map((id) => (
              <label key={id} className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                  checked={form.featuredApps.includes(id)}
                  onChange={() => toggleApp(id)}
                />
                {FEATURED_APP_LABELS[id]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5 md:col-span-2">
          <label htmlFor="ss-notes" className={label}>
            Notes
          </label>
          <textarea
            id="ss-notes"
            rows={4}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            aria-invalid={!!errors.notes}
            aria-describedby="ss-notes-help"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div id="ss-notes-help" className="flex justify-between gap-3">
            {errors.notes ? <span className={errorText}>{errors.notes}</span> : <span className={help}>Plain text, shown to visitors.</span>}
            <span className={help}>
              {form.notes.length}/{LIMITS.notes}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button
            type="submit"
            disabled={!dirty || saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {saving && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent dark:border-zinc-900" aria-hidden="true" />}
            {saving ? "Saving…" : "Save settings"}
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => {
              setForm(baseline);
              setErrors({});
              setFormError(null);
            }}
            className="inline-flex h-10 items-center rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Discard changes
          </button>
          {!dirty && <span className={help}>No unsaved changes.</span>}
        </div>
      </form>
    </section>
  );
}
