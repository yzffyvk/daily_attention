"use client";

import { useQuery } from "@tanstack/react-query";
import { getCurrentProfile } from "@/features/checkins/api";
import type { AccountProfile } from "@/server/auth/ports";
import { avatarForKey } from "./avatar-catalog";
import { AvatarImage } from "./avatar-image";

export function LearningPersona({ avatarKey, variant = "hero" }: { avatarKey: number; variant?: "hero" | "empty" }) {
  const persona = avatarForKey(avatarKey);
  return <span className={`learning-persona learning-persona--${variant}`}>
    <span className="learning-persona-art" aria-hidden="true">
      <AvatarImage avatarKey={avatarKey} width={1254} height={1254} />
    </span>
    <span className="learning-persona-caption"><strong>{persona.name}</strong><small>你的学习形象</small></span>
  </span>;
}

/** Subscribe to the same profile cache as the header, including unsaved-choice cancellation. */
export function CurrentLearningPersona({ initialProfile }: { initialProfile?: AccountProfile | null }) {
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getCurrentProfile, initialData: initialProfile ?? undefined });
  return profile ? <LearningPersona avatarKey={profile.avatarKey} variant="empty" /> : null;
}
