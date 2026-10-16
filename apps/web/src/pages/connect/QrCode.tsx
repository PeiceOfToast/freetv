import { useMemo } from "react";
import { encodeQr, qrPathData } from "@/lib/qr";

/** Inline SVG QR code. Always white so it scans in dark mode too. */
export default function QrCode({ value, label }: { value: string; label: string }) {
  const grid = useMemo(() => encodeQr(value), [value]);

  if (!grid) {
    return (
      <p className="flex h-36 w-36 shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-2 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        Too long for a QR code. Copy the link instead.
      </p>
    );
  }

  const size = grid.length + 8; // four-module quiet zone on each side
  return (
    <svg
      role="img"
      aria-label={`QR code for the ${label} link`}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="h-36 w-36 shrink-0 rounded-lg bg-white"
    >
      <path d={qrPathData(grid, 4)} fill="#000" />
    </svg>
  );
}
