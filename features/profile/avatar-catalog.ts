// Presentation only: keep these numeric keys aligned with existing profiles.
export const avatarOptions = [
  { key: 1, name: "白日梦家", description: "让想象先走一步", src: "/avatars/aura-dreamer.png" },
  { key: 2, name: "学者", description: "把好奇读成理解", src: "/avatars/aura-scholar.png" },
  { key: 3, name: "技术发烧友", description: "想明白，也要跑起来", src: "/avatars/aura-technophile.png" },
  { key: 4, name: "摸鱼家", description: "休息也是一种蓄力", src: "/avatars/aura-lounger.png" },
  { key: 5, name: "行动派", description: "把学到的，变成做到的", src: "/avatars/aura-doer.png" },
] as const;

export function avatarPath(key: number) {
  return (avatarOptions.find(option => option.key === key) ?? avatarOptions[0]).src;
}
