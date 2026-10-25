export function Logo({ large = false }: { large?: boolean }) {
  return (
    <img
      className={large ? "logo large" : "logo"}
      src="/omnix-logo.png"
      alt="Omnix"
    />
  );
}

export function Avatar({ name, color = 0 }: { name: string; color?: number }) {
  return (
    <span className={"avatar color-" + color}>
      {name
        .split(/[ @]/)
        .filter(Boolean)
        .slice(0, 2)
        .map((x) => x[0])
        .join("")
        .toUpperCase()}
    </span>
  );
}
