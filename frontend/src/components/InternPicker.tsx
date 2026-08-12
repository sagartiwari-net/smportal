import { useState } from "react";

export type OtherGroup = { id: string; name: string };

export type AvailableIntern = {
  internId: string;
  fullName: string;
  email: string;
  otherGroups: OtherGroup[];
};

export type CollegeBucket = {
  id: string;
  name: string;
  interns: AvailableIntern[];
};

type Props = {
  colleges: CollegeBucket[];
  noCollege: AvailableIntern[];
  selected: string[];
  onToggle: (internId: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  loading?: boolean;
  onOpenIntern?: (internId: string, label: string) => void;
  onOpenCollege?: (name: string) => void;
  onOpenGroup?: (name: string) => void;
};

export function InternPicker({
  colleges,
  noCollege,
  selected,
  onToggle,
  search,
  onSearchChange,
  loading,
  onOpenIntern,
  onOpenCollege,
  onOpenGroup,
}: Props) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  function toggleOpen(key: string) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderIntern(i: AvailableIntern) {
    const inOther = i.otherGroups.length > 0;
    return (
      <div key={i.internId} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
        <input
          type="checkbox"
          className="mt-1"
          checked={selected.includes(i.internId)}
          onChange={() => onToggle(i.internId)}
        />
        <span className="min-w-0">
          {onOpenIntern ? (
            <button
              type="button"
              className="font-medium text-green-800 underline-offset-2 hover:underline"
              onClick={() => onOpenIntern(i.internId, i.fullName)}
            >
              {i.fullName}
            </button>
          ) : (
            <span className="font-medium text-slate-900">{i.fullName}</span>
          )}
          <span className="block text-xs text-slate-400">{i.email}</span>
          {inOther && (
            <span className="mt-0.5 block text-xs text-amber-700">
              Already in:{" "}
              {i.otherGroups.map((g, idx) => (
                <span key={g.id}>
                  {idx > 0 ? ", " : ""}
                  {onOpenGroup ? (
                    <button
                      type="button"
                      className="underline-offset-2 hover:underline"
                      onClick={() => onOpenGroup(g.name)}
                    >
                      {g.name}
                    </button>
                  ) : (
                    g.name
                  )}
                </span>
              ))}
            </span>
          )}
        </span>
      </div>
    );
  }

  const sections: { key: string; title: string; count: number; interns: AvailableIntern[]; collegeName?: string }[] = [
    ...colleges.map((c) => ({
      key: `c:${c.id}`,
      title: c.name,
      count: c.interns.length,
      interns: c.interns,
      collegeName: c.name,
    })),
  ];
  if (noCollege.length > 0) {
    sections.push({
      key: "none",
      title: "No college (direct / manual)",
      count: noCollege.length,
      interns: noCollege,
    });
  }

  return (
    <div className="space-y-2">
      <input
        className="w-full rounded-lg border px-3 py-2 text-sm"
        placeholder="Search name or email…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {loading ? (
        <p className="text-sm text-slate-500">Loading interns…</p>
      ) : sections.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-slate-500">No available interns for this list.</p>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-2">
          {sections.map((sec) => {
            const open = openKeys.has(sec.key);
            return (
              <div key={sec.key} className="overflow-hidden rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => toggleOpen(sec.key)}
                  className="flex w-full items-center justify-between bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-100"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-slate-400">{open ? "▾" : "▸"}</span>{" "}
                    {sec.collegeName && onOpenCollege ? (
                      <span
                        role="link"
                        tabIndex={0}
                        className="text-green-800 underline-offset-2 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenCollege(sec.collegeName!);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.stopPropagation();
                            onOpenCollege(sec.collegeName!);
                          }
                        }}
                      >
                        {sec.title}
                      </span>
                    ) : (
                      sec.title
                    )}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600">{sec.count}</span>
                </button>
                {open && <div className="divide-y border-t bg-white">{sec.interns.map(renderIntern)}</div>}
              </div>
            );
          })}
        </div>
      )}
      {selected.length > 0 && <p className="text-xs text-slate-500">{selected.length} selected</p>}
    </div>
  );
}
