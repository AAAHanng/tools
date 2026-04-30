import * as RadixSwitch from "@radix-ui/react-switch";
import clsx from "clsx";
import type { ReactNode } from "react";

type SwitchRowProps = {
  checked: boolean;
  disabled?: boolean;
  label: string;
  hint?: string;
  onCheckedChange: (checked: boolean) => void;
  icon?: ReactNode;
};

export function SwitchRow(props: SwitchRowProps) {
  const { checked, disabled, label, hint, onCheckedChange, icon } = props;

  return (
    <label className={clsx("switch-row", disabled && "is-disabled")}>
      <div className="switch-copy">
        <div className="switch-label">
          {icon}
          <span>{label}</span>
        </div>
        {hint ? <p>{hint}</p> : null}
      </div>
      <RadixSwitch.Root
        className="switch-root"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      >
        <RadixSwitch.Thumb className="switch-thumb" />
      </RadixSwitch.Root>
    </label>
  );
}

