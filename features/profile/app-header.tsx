"use client";

/* eslint-disable @next/next/no-img-element */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronDown, KeyRound, LogOut, Pencil, Volume2, VolumeX, X } from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { RecoveryCodeDialog } from "@/features/auth/recovery-code-dialog";
import { ApiError, getCurrentProfile, rotateRecoveryCode, updateCurrentProfile } from "@/features/checkins/api";
import { formatDate } from "@/features/checkins/dates";
import { useCheckInStats } from "@/features/checkins/queries";
import type { AccountProfile } from "@/server/auth/ports";

const avatarKeys = [1, 2, 3, 4, 5];
const profileKey = ["profile"] as const;

type AppHeaderProps = {
  initialProfile: AccountProfile | null;
  today: string;
  isCelebrating: boolean;
  isMuted: boolean;
  isBusy?: boolean;
  isDateSelectionDisabled?: boolean;
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
  returnFocusRef,
}: {
  profile: AccountProfile;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(profile.displayName);
  const [avatarKey, setAvatarKey] = useState(profile.avatarKey);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const normalizedName = normalizeDisplayName(name);
  const nameChanged = normalizedName !== profile.displayName;
  const profileMutation = useMutation({
    mutationFn: updateCurrentProfile,
    onSuccess(updated) {
      queryClient.setQueryData(profileKey, updated);
    },
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const returnFocusTarget = returnFocusRef.current;
    const focusTimer = window.setTimeout(() => nameInputRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
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
      returnFocusTarget?.focus();
    };
  }, [returnFocusRef]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const avatarChanged = avatarKey !== profile.avatarKey;
    if (!nameChanged && !avatarChanged) {
      onClose();
      return;
    }

    setError("");
    try {
      await profileMutation.mutateAsync({
        displayName: nameChanged ? normalizedName : profile.displayName,
        avatarKey,
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
        <p>邮箱不可修改；头像和名称可以随时更新。</p>
        <form className="profile-form" onSubmit={submit}>
          <div className="auth-field">
            <span>邮箱</span>
            <span className="profile-email-value" id="profile-email">{profile.email}</span>
          </div>
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

function RecoveryCodeRotationDialog({
  onClose,
  onRotated,
  returnFocusRef,
}: {
  onClose: () => void;
  onRotated: (recoveryCode: string) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const completedRef = useRef(false);
  const rotationMutation = useMutation({
    mutationFn: rotateRecoveryCode,
  });
  const isPendingRef = useRef(rotationMutation.isPending);

  useEffect(() => {
    onCloseRef.current = onClose;
    isPendingRef.current = rotationMutation.isPending;
  });

  useEffect(() => {
    const returnFocusTarget = returnFocusRef.current;
    const focusTimer = window.setTimeout(() => passwordInputRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPendingRef.current) {
        event.preventDefault();
        onCloseRef.current();
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
      if (!completedRef.current) returnFocusTarget?.focus();
    };
  }, [returnFocusRef]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPassword) {
      setError("请输入当前密码");
      return;
    }
    setError("");
    try {
      const recoveryCode = await rotationMutation.mutateAsync(currentPassword);
      completedRef.current = true;
      onRotated(recoveryCode);
    } catch (mutationError) {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "恢复码更新失败，请稍后再试",
      );
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="recovery-rotation-title"
        aria-modal="true"
        className="switch-dialog recovery-rotation-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <button
          aria-label="关闭恢复码更新"
          className="dialog-close icon-button"
          disabled={rotationMutation.isPending}
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
        <p className="eyebrow">ACCOUNT SECURITY</p>
        <h2 id="recovery-rotation-title">更新恢复码</h2>
        <p>生成新恢复码后，旧恢复码会立即失效。请先确认当前密码。</p>
        <form className="recovery-rotation-form" onSubmit={submit}>
          <label className="auth-field" htmlFor="recovery-rotation-password">
            <span>当前密码</span>
            <input
              aria-describedby={error ? "recovery-rotation-error" : undefined}
              aria-invalid={error ? "true" : undefined}
              autoComplete="current-password"
              id="recovery-rotation-password"
              onChange={(event) => setCurrentPassword(event.target.value)}
              ref={passwordInputRef}
              type="password"
              value={currentPassword}
            />
          </label>
          {error ? (
            <p className="login-error" id="recovery-rotation-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button
              className="primary-button"
              disabled={rotationMutation.isPending || !currentPassword}
              type="submit"
            >
              {rotationMutation.isPending ? "正在生成…" : "生成新的恢复码"}
            </button>
            <button
              className="text-button"
              disabled={rotationMutation.isPending}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
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
  isBusy = false,
  isDateSelectionDisabled = false,
  onSelectToday,
  onToggleMuted,
  onRequestLogout,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [recoveryRotationOpen, setRecoveryRotationOpen] = useState(false);
  const [rotatedRecoveryCode, setRotatedRecoveryCode] = useState("");
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const [previousBusy, setPreviousBusy] = useState(isBusy);
  const profileQuery = useQuery({
    queryKey: profileKey,
    queryFn: getCurrentProfile,
    initialData: initialProfile ?? undefined,
  });
  const statsQuery = useCheckInStats(today);
  const profile = profileQuery.data ?? initialProfile;
  const stats = statsQuery.data;
  const hasTodayRecord = stats?.hasTodayRecord ?? false;
  const statsMessage = statsQuery.error instanceof ApiError
    ? statsQuery.error.message
    : "学习统计读取失败，请稍后重试";

  if (previousBusy !== isBusy) {
    setPreviousBusy(isBusy);
    if (isBusy) {
      setMenuOpen(false);
      setProfileOpen(false);
      setRecoveryRotationOpen(false);
      setRotatedRecoveryCode("");
    }
  }

  function requestLogout() {
    if (isBusy) return;
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
                  disabled={isBusy}
                  onClick={() => setMenuOpen((open) => !open)}
                  ref={accountTriggerRef}
                  type="button"
                >
                  <img alt="" src={avatarPath(profile.avatarKey)} />
                  <strong>{profile.displayName}</strong>
                  <ChevronDown aria-hidden="true" size={14} />
                </button>
                {menuOpen ? (
                  <div aria-label="账户菜单" className="account-menu" role="menu">
                    <button
                      disabled={isBusy}
                      onClick={() => {
                        setMenuOpen(false);
                        setProfileOpen(true);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={15} />编辑资料
                    </button>
                    <button
                      disabled={isBusy}
                      onClick={() => {
                        setMenuOpen(false);
                        setRecoveryRotationOpen(true);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <KeyRound aria-hidden="true" size={15} />更新恢复码
                    </button>
                    <button disabled={isBusy} onClick={requestLogout} role="menuitem" type="button">
                      <LogOut aria-hidden="true" size={15} />退出登录
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <button aria-label="退出当前用户" className="account-logout" disabled={isBusy} onClick={requestLogout} title="退出当前用户" type="button">
                <LogOut aria-hidden="true" size={16} />
              </button>
            )}
          </div>
          <div className="brand-title-row">
            <span aria-hidden="true" className="brand-monogram">A</span>
            <h1>
              今天你<span>attention</span>了吗？
            </h1>
          </div>
          <div aria-hidden="true" className="attention-trace">
            <span />
            <span />
            <span />
            <span />
          </div>
          <p className="hero-copy">每天留下一点新知，慢慢长成自己的知识地图。</p>
        </div>

        <div className="header-dashboard">
          <div className={`today-summary${hasTodayRecord ? " complete" : ""}`}>
            <button
              aria-label={isMuted ? "开启打卡提示音" : "关闭打卡提示音"}
              className="icon-button sound-button"
              disabled={isBusy}
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
              <strong>
                {stats
                  ? hasTodayRecord
                    ? "已经打卡"
                    : "等待 attention"
                  : statsQuery.isError
                    ? "统计待重试"
                    : "正在读取"}
              </strong>
            </div>
          </div>
          <div
            aria-busy={statsQuery.isPending || statsQuery.isFetching}
            aria-label="学习统计"
            className="metric-row"
          >
            <div>
              <span>当前连续</span>
              <strong>{stats?.currentStreak ?? "—"}{stats ? <small>天</small> : null}</strong>
            </div>
            <div>
              <span>累计记录</span>
              <strong>{stats?.totalCount ?? "—"}{stats ? <small>篇</small> : null}</strong>
            </div>
          </div>
          {statsQuery.isError ? (
            <div
              aria-label="学习统计错误"
              className="stats-query-error"
              role="status"
            >
              <span>{statsMessage}</span>
              <button
                disabled={statsQuery.isFetching}
                onClick={() => void statsQuery.refetch()}
                type="button"
              >
                {statsQuery.isFetching ? "正在重试…" : "重试学习统计"}
              </button>
            </div>
          ) : null}
          <button className="today-button" disabled={isBusy || isDateSelectionDisabled} onClick={onSelectToday} type="button">
            <CalendarDays aria-hidden="true" size={18} />
            {stats
              ? hasTodayRecord
                ? "回看今日记录"
                : "开始今日打卡"
              : "查看今日"}
          </button>
        </div>
      </header>
      {profileOpen && profile && !isBusy ? <ProfileDialog onClose={() => setProfileOpen(false)} profile={profile} returnFocusRef={accountTriggerRef} /> : null}
      {recoveryRotationOpen && profile && !isBusy ? (
        <RecoveryCodeRotationDialog
          onClose={() => setRecoveryRotationOpen(false)}
          onRotated={(recoveryCode) => {
            setRecoveryRotationOpen(false);
            setRotatedRecoveryCode(recoveryCode);
          }}
          returnFocusRef={accountTriggerRef}
        />
      ) : null}
      {rotatedRecoveryCode && profile && !isBusy ? (
        <RecoveryCodeDialog
          name={profile.displayName}
          onClose={() => setRotatedRecoveryCode("")}
          open
          recoveryCode={rotatedRecoveryCode}
        />
      ) : null}
    </>
  );
}
