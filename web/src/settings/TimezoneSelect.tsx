import Select from "../components/Select";
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const supported =
  (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: string) => string[];
    }
  ).supportedValuesOf?.("timeZone") || [];

export function currentTimezone() {
  return browserZone;
}

export default function TimezoneSelect({
  value,
  onChange
}: {
  value: string;
  onChange: (zone: string) => void;
}) {
  const zones = Array.from(new Set(["UTC", browserZone, value, ...supported]))
    .filter(Boolean)
    .sort();
  const groups = new Map<string, string[]>();
  for (const zone of zones) {
    const group = zone.includes("/") ? zone.split("/")[0] : "Universal";
    groups.set(group, [...(groups.get(group) || []), zone]);
  }
  return (
    <Select
      searchable
      aria-label="Time zone"
      value={value || browserZone}
      onChange={(event) => onChange(event.target.value)}
    >
      {Array.from(groups, ([group, options]) => (
        <optgroup key={group} label={group}>
          {options.map((zone) => (
            <option value={zone} key={zone}>
              {zone.replaceAll("_", " ")}
              {zone === browserZone ? " · Device timezone" : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
