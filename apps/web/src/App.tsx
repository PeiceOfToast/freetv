import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import BrowsePage from "./pages/browse/BrowsePage";
import WatchPage from "./pages/watch/WatchPage";
import GuidePage from "./pages/guide/GuidePage";
import AboutPage from "./pages/about/AboutPage";
import TvPage from "./pages/tv/TvPage";

export default function App() {
  return (
    <Routes>
      {/* 10-foot UI: no site chrome, owns the whole viewport */}
      <Route path="tv/*" element={<TvPage />} />
      <Route element={<Layout />}>
        <Route index element={<BrowsePage />} />
        <Route path="watch/:id" element={<WatchPage />} />
        <Route path="guide" element={<GuidePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="*" element={<div className="p-8 text-center opacity-70">Not found</div>} />
      </Route>
    </Routes>
  );
}
