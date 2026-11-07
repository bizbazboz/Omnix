import Select from "../../components/Select";
import { controlNames, type Command, type Device, initialCommand } from "./api";

export default function ActionEditor({
  device,
  value,
  onChange,
  disabled = false
}: {
  device?: Device;
  value: Command;
  onChange: (command: Command) => void;
  disabled?: boolean;
}) {
  const cap = device?.capabilities.find((c) => c.instance === value.instance);
  return (
    <div className="iot-action-fields">
      <label className="form-label">
        Control
        <Select
          aria-label="Control"
          disabled={disabled || !device}
          value={value.instance}
          onChange={(e) => {
            const next = device?.capabilities.find(
              (c) => c.instance === e.target.value
            );
            onChange(
              next
                ? {
                    instance: next.instance,
                    value:
                      next.parameters.options?.[0]?.value ??
                      next.parameters.range?.min ??
                      0
                  }
                : initialCommand(device)
            );
          }}
        >
          {device?.capabilities.map((c) => (
            <option value={c.instance} key={c.instance}>
              {controlNames[c.instance] || c.instance}
            </option>
          ))}
        </Select>
      </label>
      {cap?.parameters.options ? (
        <label className="form-label">
          Value
          <Select
            aria-label="Control value"
            disabled={disabled}
            value={JSON.stringify(value.value)}
            onChange={(e) =>
              onChange({ ...value, value: JSON.parse(e.target.value) })
            }
          >
            {cap.parameters.options.map((o, i) => (
              <option key={i} value={JSON.stringify(o.value)}>
                {o.name}
              </option>
            ))}
          </Select>
        </label>
      ) : cap?.instance === "colorRgb" ? (
        <label className="form-label">
          Colour
          <input
            aria-label="Light colour"
            disabled={disabled}
            type="color"
            value={
              "#" +
              Number(value.value || 0)
                .toString(16)
                .padStart(6, "0")
            }
            onChange={(e) =>
              onChange({
                ...value,
                value: parseInt(e.target.value.slice(1), 16)
              })
            }
          />
        </label>
      ) : cap?.parameters.range ? (
        <label className="form-label">
          {controlNames[cap.instance]}
          <input
            aria-label="Control value"
            disabled={disabled}
            required
            type="number"
            min={cap.parameters.range.min}
            max={cap.parameters.range.max}
            step="1"
            value={String(value.value ?? "")}
            onChange={(e) =>
              onChange({
                ...value,
                value: e.target.value === "" ? "" : Number(e.target.value)
              })
            }
          />
        </label>
      ) : null}
    </div>
  );
}
