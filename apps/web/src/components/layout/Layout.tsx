import { NavLink, Outlet } from "react-router-dom";
import { useTheme } from "@/lib/theme";

const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${isActive ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"}`;

export function Layout() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto max-w-screen-2xl px-4 h-14 flex items-center gap-2">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight mr-4">
            <img src="/favicon.svg" alt="" className="h-7 w-7" /> FreeTV
          </NavLink>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={link}>Channels</NavLink>
            <NavLink to="/guide" className={link}>Guide</NavLink>
            <NavLink to="/about" className={link}>About</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}
              className="text-sm bg-transparent border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1">
              <option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option>
            </select>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-screen-2xl px-4 py-4">
        <Outlet />
      </main>
      <footer className="border-t border-zinc-200/80 dark:border-zinc-800/80 py-4 text-center text-xs opacity-60">
        Channel data from <a className="underline" href="https://github.com/iptv-org/iptv">iptv-org</a>. FreeTV hosts no streams. MIT licensed.
      </footer>
    </div>
  );
}
