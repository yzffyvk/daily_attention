"use client";

/* eslint-disable @next/next/no-img-element */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronDown, LogOut, Pencil, Volume2, VolumeX, X } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ApiError, getCurrentProfile, updateCurrentProfile } from "@/features/checkins/api";
import { formatDate } from "@/features/checkins/dates";
import type { AccountProfile } from "@/server/auth/ports";

const avatarKeys = [1, 2, 3, 4, 5];
const profileKey = ["profile"] as const;

type AppHeaderProps = {
  initialProfile: AccountProfile | null;
  today: string;
  isCelebrating: boolean;
  isMuted: boolean;
  hasTodayRecord: boolean;
  streak: number;
  totalRecords: number;
  onSelectToday: () => void;
  onToggleMuted: () => void;
  onRequestLogout: () => void;
};

function avatarPath(avatarKey: number) {
  return `/avatars/avatar-${avatarKey}.svg`;
}

function normalizeDisplayName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function ProfileDialog({
  profile,
  onClose,
}: {
  profile: AccountProfile;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(profile.displayName);
  const [avatarKey, setAvatarKey] = useState(profile.avatarKey);
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const normalizedName = normalizeDisplayName(name);
  const nameChanged = normalizedName !== profile.displayName;
  const profileMutation = useMutation({
    mutationFn: updateCurrentProfile,
    onSuccess(updated) {
      queryClient.setQueryData(profileKey, updated);
    },
  });

  useEffect(() => {
    priorFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => nameInputRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      priorFocusRef.current?.focus();
    };
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const avatarChanged = avatarKey !== profile.avatarKey;
    if (!nameChanged && !avatarChanged) {
      onClose();
      return;
    }
    if (nameChanged && !currentPassword) {
      setError("修改名称需要输入当前密码");
      return;
    }

    setError("");
    try {
      await profileMutation.mutateAsync({
        avatarKey,
        ...(nameChanged ? { name: normalizedName, currentPassword } : {}),
      });
      onClose();
    } catch (mutationError) {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "资料保存失败，请稍后再试",
      );
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="profile-dialog-title"
        aria-modal="true"
        className="switch-dialog profile-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <button aria-label="关闭资料设置" className="dialog-close icon-button" onClick={onClose} type="button">
          <X aria-hidden="true" size={18} />
        </button>
        <p className="eyebrow">PROFILE</p>
        <h2 id="profile-dialog-title">编辑资料</h2>
        <p>头像可以随时更新；修改名称时需要确认当前密码。</p>
        <form className="profile-form" onSubmit={submit}>
          <label className="auth-field" htmlFor="profile-name">
            <span>名称</span>
            <input
              autoComplete="username"
              id="profile-name"
              maxLength={20}
              onChange={(event) => setName(event.target.value)}
              ref={nameInputRef}
              value={name}
            />
          </label>
          <fieldset className="avatar-fieldset">
            <legend>选择头像</legend>
            <div className="avatar-options">
              {avatarKeys.map((option) => (
                <label className={`avatar-option${avatarKey === option ? " selected" : ""}`} key={option}>
                  <input
                    aria-label={`头像 ${option}`}
                    checked={avatarKey === option}
                    name="profile-avatar"
                    onChange={() => setAvatarKey(option)}
                    type="radio"
                    value={option}
                  />
                  <img alt="" src={avatarPath(option)} />
                  {avatarKey === option ? <i aria-hidden="true"><Check size={14} strokeWidth={3} /></i> : null}
                </label>
              ))}
            </div>
          </fieldset>
          {nameChanged ? (
            <label className="auth-field" htmlFor="profile-password">
              <span>当前密码</span>
              <input
                autoComplete="current-password"
                id="profile-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
                type="password"
                value={currentPassword}
              />
            </label>
          ) : null}
          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button className="primary-button" disabled={profileMutation.isPending} type="submit">
              {profileMutation.isPending ? "正在保存…" : "保存资料"}
            </button>
            <button className="text-button" onClick={onClose} type="button">取消</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function AppHeader({
  initialProfile,
  today,
  isCelebrating,
  isMuted,
  hasTodayRecord,
  streak,
  totalRecords,
  onSelectToday,
  onToggleMuted,
  onRequestLogout,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileQuery = useQuery({
    queryKey: profileKey,
    queryFn: getCurrentProfile,
    initialData: initialProfile ?? undefined,
  });
  const profile = profileQuery.data ?? initialProfile;

  function requestLogout() {
    setMenuOpen(false);
    onRequestLogout();
  }

  return (
    <>
      <header className={`app-header${isCelebrating ? " celebrating" : ""}`}>
        <div className="header-copy">
          <div className="header-topline">
            <p className="eyebrow">AI LEARNING JOURNAL · {formatDate(today)}</p>
            {profile ? (
              <div className="account-menu-wrap">
                <button
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  aria-label="打开账户菜单"
                  className="current-account"
                  onClick={() => setMenuOpen((open) => !open)}
                  type="button"
                >
                  <img alt="" src={avatarPath(profile.avatarKey)} />
                  <strong>{profile.displayName}</strong>
                  <ChevronDown aria-hidden="true" size={14} />
                </button>
                {menuOpen ? (
                  <div aria-label="账户菜单" className="account-menu" role="menu">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setProfileOpen(true);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={15} />编辑资料
                    </button>
                    <button onClick={requestLogout} role="menuitem" type="button">
                      <LogOut aria-hidden="true" size={15} />退出登录
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <button aria-label="退出当前用户" className="account-logout" onClick={onRequestLogout} title="退出当前用户" type="button">
                <LogOut aria-hidden="true" size={16} />
              </button>
            )}
          </div>
          <h1>
            今天你<span>attention</span>了吗？
          </h1>
          <p className="hero-copy">每天留下一点新知，慢慢长成自己的知识地图。</p>
        </div>

        <div className="header-dashboard">
          <div className={`today-summary${hasTodayRecord ? " complete" : ""}`}>
            <button
              aria-label={isMuted ? "开启打卡提示音" : "关闭打卡提示音"}
              className="icon-button sound-button"
              onClick={onToggleMuted}
              title={isMuted ? "开启打卡提示音" : "关闭打卡提示音"}
              type="button"
            >
              {isMuted ? <VolumeX aria-hidden="true" size={18} /> : <Volume2 aria-hidden="true" size={18} />}
            </button>
            <span aria-hidden="true" className="status-mark">
              {hasTodayRecord ? <Check size={15} strokeWidth={3} /> : null}
            </span>
            <div>
              <small>今天</small>
              <strong>{hasTodayRecord ? "已经打卡" : "等待 attention"}</strong>
            </div>
          </div>
          <div aria-label="学习统计" className="metric-row">
            <div>
              <span>本月连续</span>
              <strong>{streak}<small>天</small></strong>
            </div>
            <div>
              <span>本月记录</span>
              <strong>{totalRecords}<small>篇</small></strong>
            </div>
          </div>
          <button className="today-button" onClick={onSelectToday} type="button">
            <CalendarDays aria-hidden="true" size={18} />
            {hasTodayRecord ? "回看今日记录" : "开始今日打卡"}
          </button>
        </div>
      </header>
      {profileOpen && profile ? <ProfileDialog onClose={() => setProfileOpen(false)} profile={profile} /> : null}
    </>
  );
}
