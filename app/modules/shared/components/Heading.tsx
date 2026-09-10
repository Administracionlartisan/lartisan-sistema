type HeadingProps = { k: string; h: string; p: string };

export default function Heading({ k, h, p }: HeadingProps) {
  return (
    <div className="mb-6">
      <p className="text-sm font-bold text-[#ec3a35]">{k}</p>
      <h1 className="mt-1 text-3xl font-bold">{h}</h1>
      <p className="mt-1 text-slate-500">{p}</p>
    </div>
  );
}
