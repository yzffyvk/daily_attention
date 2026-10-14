"use client";

import { useState, type ImgHTMLAttributes } from "react";
import { useColorTheme } from "@/features/theme/theme";
import { avatarPath } from "./avatar-catalog";

export function AvatarImage({ avatarKey, animated = false, onError, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & { avatarKey: number; animated?: boolean }) {
  const theme = useColorTheme();
  const [failedAnimation, setFailedAnimation] = useState<string | null>(null);
  const source = avatarPath(avatarKey, theme);
  const animation = source.replace("/avatars/", "/avatars/motion/").replace(/\.png$/, ".webp");
  // Both themes use the same profile key; switching never writes account data.
  // eslint-disable-next-line @next/next/no-img-element
  const portrait = <img {...props} alt="" data-avatar-theme={theme} src={source} onError={event => {
    if (animated) setFailedAnimation(animation);
    onError?.(event);
  }} />;
  if (!animated) return portrait;
  return <picture>
    {failedAnimation !== animation && <source
      media="(prefers-reduced-motion: no-preference)"
      srcSet={animation}
      type="image/webp"
    />}
    {portrait}
  </picture>;
}
