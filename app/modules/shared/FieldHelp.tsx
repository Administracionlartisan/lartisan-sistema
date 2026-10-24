type FieldHelpProps = {
  children: string;
};

/**
 * Ayuda corta junto a los campos operativos. Se abre con mouse, foco de
 * teclado o toque: no obliga a salir de la operación para entender un dato.
 */
export function FieldHelp({ children }: FieldHelpProps) {
  return (
    <span className="group relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label={`Ayuda: ${children}`}
        className="grid h-4 w-4 place-items-center rounded-full border border-[#183a67] bg-white text-[11px] font-black leading-none text-[#183a67]"
      >
        !
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded bg-slate-900 px-3 py-2 text-left text-xs font-normal leading-snug text-white shadow-lg group-hover:visible group-focus-within:visible"
      >
        {children}
      </span>
    </span>
  );
}
