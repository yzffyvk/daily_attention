"use client";

/* eslint-disable @next/next/no-img-element */
import { Check } from "lucide-react";
import { useId } from "react";
import { avatarOptions } from "./avatar-catalog";

type AvatarSelectorProps = {
  value: number | null;
  name: string;
  onChange: (key: number) => void;
  disabled?: boolean;
};

export function AvatarSelector({ value, name, onChange, disabled = false }: AvatarSelectorProps) {
  const descriptionId = useId();
  return (
    <div className="aura-avatar-grid">
      {avatarOptions.map(option => (
        <label className={`aura-avatar-card${value === option.key ? " selected" : ""}`} key={option.key}>
          <input
            aria-label={option.name}
            aria-describedby={`${descriptionId}-${option.key}`}
            checked={value === option.key}
            disabled={disabled}
            name={name}
            onChange={() => onChange(option.key)}
            type="radio"
            value={option.key}
          />
          <span className="aura-avatar-art">
            <img alt="" src={option.src} width={512} height={512} loading="lazy" decoding="async" />
          </span>
          <span className="aura-avatar-name">{option.name}</span>
          <span className="aura-avatar-description" id={`${descriptionId}-${option.key}`}>{option.description}</span>
          {value === option.key && <span className="aura-avatar-selected" aria-hidden="true"><Check size={12} strokeWidth={2.5} /></span>}
        </label>
      ))}
    </div>
  );
}
