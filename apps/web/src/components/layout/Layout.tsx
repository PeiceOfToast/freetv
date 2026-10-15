import { NavLink, Outlet } from "react-router-dom";
import { useTheme } from "@/lib/theme";
import { promptInstall, useCanInstall, useIosInstallHint } from "@/lib/pwa";
import { UpdateToast } from "./UpdateToast";

// Touch targets are 44 px tall on touch screens (min-h-11). pointer-fine (mouse) keeps the compact
// desktop size. Narrow phones get tighter horizontal padding so the header fits in 320 px.
const link = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 pointer-fine:min-h-0 items-center px-2 sm:px-3 sm:py-1.5 rounded-md text-sm font-medium transition-colors ${isActive ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"}`;

function InstallButton() {
  const canInstall = useCanInstall();
  if (!canInstall) return null;
  return (
    <button
      type="button"
      onClick={() => void promptInstall()}
      aria-label="Install FreeTV app"
      title="Install app"
      className="inline-flex min-h-11 min-w-11 pointer-fine:min-h-0 sm:min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-300 px-2 text-sm font-medium hover:bg-zinc-200/60 dark:border-zinc-700 dark:hover:bg-zinc-800/60"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </svg>
      <span className="hidden sm:inline">Install app</span>
    </button>
  );
}

function IosInstallHint() {
  const { show, dismiss } = useIosInstallHint();
  if (!show) return null;
  return (
    <div
      role="region"
      aria-label="Install FreeTV"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-sm text-zinc-800 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-100"
    >
      <div className="mx-auto flex max-w-screen-sm items-start gap-3">
        <p className="min-w-0 flex-1">
          Install FreeTV: tap the <span className="font-semibold">Share</span> button, then <span className="font-semibold">Add to Home Screen</span>.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-3 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function Layout() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="min-h-screen flex flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-screen-2xl px-4 h-14 flex items-center gap-1 sm:gap-2">
          {/* The tap area is 44 px (p-2) but the layout box stays 28 px (-m-2). */}
          <NavLink to="/" className="hidden min-[380px]:flex shrink-0 items-center gap-2 p-2 -m-2 mr-2 sm:mr-4 font-semibold tracking-tight">
            <img src="/favicon.svg" alt="" className="h-7 w-7" /> <span className="hidden sm:inline">FreeTV</span>
          </NavLink>
          <nav className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <NavLink to="/" end className={link}>Channels</NavLink>
            <NavLink to="/guide" className={link}>Guide</NavLink>
            <NavLink to="/about" className={link}>About</NavLink>
            <NavLink to="/tv" className={link + " hidden sm:inline-flex"} title="10-foot mode for TVs">TV mode</NavLink>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
            <InstallButton />
            <select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}
              className="min-h-11 pointer-fine:min-h-0 text-sm bg-transparent border border-zinc-300 dark:border-zinc-700 rounded-md px-1.5 py-1 max-w-24">
              <option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option>
            </select>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-screen-2xl px-4 py-4">
        <Outlet />
      </main>
      <footer className="border-t border-zinc-200/80 dark:border-zinc-800/80 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-xs opacity-60">
        Channel data from <a className="underline" href="https://github.com/iptv-org/iptv">iptv-org</a>. FreeTV hosts no streams. MIT licensed.
      </footer>
      <IosInstallHint />
      <UpdateToast />
    </div>
  );
}
