import { Navigate, Route, Routes } from "react-router-dom";
import "./tv.css";
import { TvShell } from "./TvShell";
import HomePage from "./HomePage";
import BrowsePage from "./BrowsePage";
import WatchPage from "./WatchPage";
import GuidePage from "./GuidePage";
import SettingsPage from "./SettingsPage";

/**
 * 10-foot UI, mounted at /tv/* by App.tsx outside the site Layout.
 * Watch and Guide are full-width; Home, Browse and Settings sit inside the left rail.
 */
export default function TvPage() {
  return (
    <Routes>
      <Route element={<TvShell />}>
        <Route index element={<HomePage />} />
        <Route path="browse" element={<BrowsePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="watch/:id" element={<WatchPage />} />
      <Route path="guide" element={<GuidePage />} />
      <Route path="*" element={<Navigate to="/tv" replace />} />
    </Routes>
  );
}
