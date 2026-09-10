/* eslint-disable @next/next/no-img-element */
export function AuraMark({ className = "" }: { className?: string }) {
  return <img className={`aura-mark ${className}`} src="/aura-icon.svg" alt="" aria-hidden="true" width={64} height={64} />;
}
