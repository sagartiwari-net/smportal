export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-green-700">{title}</h1>
      {subtitle ? <p className="mt-1 text-slate-500">{subtitle}</p> : null}
    </div>
  );
}
