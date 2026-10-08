import { useMemo } from "react";
import { toSvg } from "./vendor/peek/svg";

interface UserAvatarProps {
  userId?: string;
  name: string;
  size?: number;
  decorative?: boolean;
}

export function userAvatarSource(
  userId: string | undefined,
  name: string,
  size: number,
) {
  const seed = userId?.trim() || name.trim() || "user";
  const svg = toSvg(seed, {
    version: 1,
    size,
    expression: "happy",
    square: false,
    title: false,
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function UserAvatar({
  userId,
  name,
  size = 34,
  decorative = false,
}: UserAvatarProps) {
  const src = useMemo(
    () => userAvatarSource(userId, name, size),
    [userId, name, size],
  );
  return (
    <img
      className="user-avatar-image"
      src={src}
      width={size}
      height={size}
      alt={decorative ? "" : `Avatar của ${name.trim() || "người dùng"}`}
      draggable={false}
    />
  );
}
