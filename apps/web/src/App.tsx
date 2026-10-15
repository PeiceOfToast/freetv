import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import BrowsePage from "./pages/browse/BrowsePage";

// Everything that pulls in hls.js or the big guide/TV code is lazy so the browse page stays small.
const WatchPage = lazy(() => import("./pages/watch/WatchPage"));
const GuidePage = lazy(() => import("./pages/guide/GuidePage"));
const AboutPage = lazy(() => import("./pages/about/AboutPage"));
const TvPage = lazy(() => import("./pages/tv/TvPage"));
const AdminPage = lazy(() => import("./pages/admin/AdminPage"));

const Fallback = () => (
  <div className="flex items-center justify-center p-16 text-sm opacity-60" role="status">
    Loading…
  </div>
);

export default function App() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        {/* 10-foot UI: no site chrome, owns the whole viewport */}
        <Route path="tv/*" element={<TvPage />} />
        <Route element={<Layout />}>
          <Route index element={<BrowsePage />} />
          <Route path="watch/:id" element={<WatchPage />} />
          <Route path="guide" element={<GuidePage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="*" element={<div className="p-8 text-center opacity-70">Not found</div>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
