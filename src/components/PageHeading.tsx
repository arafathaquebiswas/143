/** The shared heading block at the top of every signed-in page. */
export default function PageHeading({
  eyebrow,
  title,
  hint,
}: {
  eyebrow: string;
  title: string;
  hint: string;
}) {
  return (
    <header className="animate-reveal">
      <p className="tracked text-[0.625rem] font-semibold text-accent">{eyebrow}</p>
      <h1 className="display mt-3 text-[2.25rem] leading-none sm:text-[3rem]">{title}</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">{hint}</p>
    </header>
  );
}
