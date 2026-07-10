export function PagePlaceholder({
  title,
  description,
  phaseNote,
}: {
  title: string;
  description: string;
  phaseNote: string;
}) {
  return (
    <div>
      <h1 className="text-display font-semibold text-foreground">{title}</h1>
      <p className="mt-1 text-body-lg text-muted-foreground">{description}</p>
      <div className="mt-6 rounded-md border border-dashed border-border bg-card p-8 text-center">
        <p className="text-body-sm text-muted-foreground">{phaseNote}</p>
      </div>
    </div>
  );
}
