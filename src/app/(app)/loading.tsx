/** Shown while a page's data is still on its way. Matches the real layout so
 *  navigating never feels like a jump. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="skeleton h-9 w-56 rounded-lg" />
        <div className="skeleton h-4 w-72 rounded" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton aspect-4/5 rounded-[var(--radius-card)]" />
        ))}
      </div>
    </div>
  );
}
