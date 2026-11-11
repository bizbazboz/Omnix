import { weatherLabel } from "./api";

/** Code-native dot-matrix symbols; no external icon/font/image requests. */
export default function WeatherGlyph({
  code,
  size = 32
}: {
  code: number | null;
  size?: number;
}) {
  const kind = weatherLabel(code);
  const cloud = (x: number, y: number) =>
    (x - 10) ** 2 + (y - 12) ** 2 < 22 ||
    (x - 14) ** 2 + (y - 11) ** 2 < 26 ||
    (x - 18) ** 2 + (y - 13) ** 2 < 16 ||
    (x >= 7 && x <= 19 && y >= 12 && y <= 15);
  const dots = [];
  for (let y = 1; y < 24; y++)
    for (let x = 1; x < 24; x++) {
      const dx = x - 12,
        dy = y - 12,
        r = dx * dx + dy * dy;
      const sun =
        r < 22 ||
        (r > 38 &&
          r < 83 &&
          (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)));
      const rain = y >= 18 && y <= 21 && (x + y) % 5 === 0 && x >= 7 && x <= 19;
      const snow =
        y >= 18 &&
        y <= 22 &&
        [8, 14, 20].some((cx) => Math.abs(x - cx) + Math.abs(y - 20) <= 1);
      const fog = [17, 20].includes(y) && x >= 5 && x <= 20 && x % 5 !== 0;
      const bolt =
        (y >= 17 && y <= 19 && x === 14 - y + 18) ||
        (y >= 20 && y <= 23 && x === 34 - y);
      const visible =
        kind === "Clear"
          ? sun
          : kind === "No reading"
            ? r > 30 && r < 48
            : cloud(x, y) ||
              (kind === "Rain" && rain) ||
              (kind === "Snow" && snow) ||
              (kind === "Fog" && fog) ||
              (kind === "Thunderstorms" && bolt);
      if (visible)
        dots.push(<circle key={`${x}-${y}`} cx={x * 4} cy={y * 4} r="1.5" />);
    }
  return (
    <svg
      className="weather-glyph"
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="currentColor"
      aria-hidden="true"
    >
      {dots}
    </svg>
  );
}
