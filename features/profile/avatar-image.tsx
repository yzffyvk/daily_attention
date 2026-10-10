"use client";

import type { ImgHTMLAttributes } from "react";
import { useColorTheme } from "@/features/theme/theme";
import { avatarPath } from "./avatar-catalog";

export function AvatarImage({ avatarKey, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & { avatarKey: number }) {
  const theme = useColorTheme();
  // Both themes use the same profile key; switching never writes account data.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt="" data-avatar-theme={theme} src={avatarPath(avatarKey, theme)} />;
}
