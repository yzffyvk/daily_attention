"use client";

/* eslint-disable @next/next/no-img-element */
import confetti from "canvas-confetti";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  LogOut,
  RotateCcw,
  Trash2,
  Upload,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

type CheckIn = {
  id: string;
  date: string;
  attention: string;
  sourceUrl: string;
  summary: string;
  inspiration: string;
  imageName: string;
  imageDataUrl: string;
};

type StoredCheckIn = CheckIn & {
  userId: string;
};

type UserProfile = {
  name: string;
  avatarId: number;
  createdAt: string;
};

type Draft = {
  attention: string;
  sourceUrl: string;
  summary: string;
  inspiration: string;
  imageName: string;
  imageDataUrl: string;
  removeImage: boolean;
};

type LegacyCheckIn = Partial<CheckIn> & {
  topic?: string;
  note?: string;
};

type MessageTone = "neutral" | "success" | "error";

const LEGACY_STORAGE_KEY = "ai-learning-checkins-v1";
const MUTE_STORAGE_KEY = "attention-journal-muted";
const CURRENT_USER_STORAGE_KEY = "attention-current-user";
const DATABASE_NAME = "attention-journal";
const DATABASE_VERSION = 2;
const LEGACY_RECORD_STORE = "checkins";
const USER_STORE = "users";
const USER_RECORD_STORE = "user-checkins";
const USER_RECORD_INDEX = "by-user";
const AVATAR_IDS = [1, 2, 3, 4, 5] as const;

const emptyDraft: Draft = {
  attention: "",
  sourceUrl: "",
  summary: "",
  inspiration: "",
  imageName: "",
  imageDataUrl: "",
  removeImage: false,
};

function avatarPath(avatarId: number) {
  return `/avatars/avatar-${avatarId}.svg`;
}

function normalizeUserName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function validateUserName(value: string) {
  const normalized = normalizeUserName(value);
  const length = Array.from(normalized).length;
  if (length < 1 || length > 20) {
    throw new Error("名称需要填写 1-20 个字符");
  }
  return normalized;
}

function getTodayKey() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function getDateKey(year: number, month: number, day: number) {
  return [
    year,
    String(month + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function getDateNumber(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function getKeyFromDateNumber(dateNumber: number) {
  return new Date(dateNumber * 86400000).toISOString().slice(0, 10);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00`));
}

function calculateStreak(items: CheckIn[]) {
  const dates = new Set(items.map((item) => item.date));
  let cursor = getDateNumber(getTodayKey());
  let count = 0;

  if (!dates.has(getTodayKey())) cursor -= 1;
  while (dates.has(getKeyFromDateNumber(cursor))) {
    count += 1;
    cursor -= 1;
  }
  return count;
}

function draftFromRecord(record?: CheckIn): Draft {
  if (!record) return { ...emptyDraft };
  return {
    attention: record.attention,
    sourceUrl: record.sourceUrl,
    summary: record.summary,
    inspiration: record.inspiration,
    imageName: record.imageName,
    imageDataUrl: record.imageDataUrl,
    removeImage: false,
  };
}

function draftSignature(draft: Draft) {
  return JSON.stringify({
    attention: draft.attention,
    sourceUrl: draft.sourceUrl,
    summary: draft.summary,
    inspiration: draft.inspiration,
    imageName: draft.removeImage ? "" : draft.imageName,
    imageDataUrl: draft.removeImage ? "" : draft.imageDataUrl,
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("本地数据库打开失败"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LEGACY_RECORD_STORE)) {
        database.createObjectStore(LEGACY_RECORD_STORE, { keyPath: "date" });
      }
      if (!database.objectStoreNames.contains(USER_STORE)) {
        database.createObjectStore(USER_STORE, { keyPath: "name" });
      }
      if (!database.objectStoreNames.contains(USER_RECORD_STORE)) {
        const recordStore = database.createObjectStore(USER_RECORD_STORE, {
          keyPath: ["userId", "date"],
        });
        recordStore.createIndex(USER_RECORD_INDEX, "userId", { unique: false });
      }
    };
  });
}

async function getUserProfiles() {
  const database = await openDatabase();
  try {
    return await new Promise<UserProfile[]>((resolve, reject) => {
      const transaction = database.transaction(USER_STORE, "readonly");
      const request = transaction.objectStore(USER_STORE).getAll();
      request.onerror = () => reject(request.error ?? new Error("用户读取失败"));
      request.onsuccess = () =>
        resolve(
          (request.result as UserProfile[]).sort((left, right) =>
            left.createdAt.localeCompare(right.createdAt),
          ),
        );
    });
  } finally {
    database.close();
  }
}

async function registerUserProfile(name: string, avatarId: number) {
  const normalizedName = validateUserName(name);
  if (!AVATAR_IDS.includes(avatarId as (typeof AVATAR_IDS)[number])) {
    throw new Error("请选择一个头像");
  }

  const database = await openDatabase();
  try {
    const profile: UserProfile = {
      name: normalizedName,
      avatarId,
      createdAt: new Date().toISOString(),
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(USER_STORE, "readwrite");
      const request = transaction.objectStore(USER_STORE).add(profile);
      request.onerror = () => {
        if (request.error?.name === "ConstraintError") {
          reject(new Error("这个名称已经注册过了，请直接选择登录"));
          return;
        }
        reject(request.error ?? new Error("注册失败"));
      };
      transaction.oncomplete = () => resolve();
    });
    return profile;
  } finally {
    database.close();
  }
}

async function getStoredCheckIns(userId: string) {
  const database = await openDatabase();
  try {
    return await new Promise<CheckIn[]>((resolve, reject) => {
      const transaction = database.transaction(USER_RECORD_STORE, "readonly");
      const request = transaction
        .objectStore(USER_RECORD_STORE)
        .index(USER_RECORD_INDEX)
        .getAll(userId);
      request.onerror = () => reject(request.error ?? new Error("记录读取失败"));
      request.onsuccess = () =>
        resolve(
          (request.result as StoredCheckIn[])
            .map((storedRecord) => ({
              id: storedRecord.id,
              date: storedRecord.date,
              attention: storedRecord.attention,
              sourceUrl: storedRecord.sourceUrl,
              summary: storedRecord.summary,
              inspiration: storedRecord.inspiration,
              imageName: storedRecord.imageName,
              imageDataUrl: storedRecord.imageDataUrl,
            }))
            .sort((left, right) => right.date.localeCompare(left.date)),
        );
    });
  } finally {
    database.close();
  }
}

async function saveStoredCheckIn(userId: string, record: CheckIn) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(USER_RECORD_STORE, "readwrite");
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("记录保存失败"));
      transaction.oncomplete = () => resolve();
      transaction
        .objectStore(USER_RECORD_STORE)
        .put({ ...record, userId } satisfies StoredCheckIn);
    });
  } finally {
    database.close();
  }
}

async function migrateLegacyCheckIns() {
  const rawRecords = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!rawRecords) return;

  const parsed = JSON.parse(rawRecords) as LegacyCheckIn[];
  if (!Array.isArray(parsed)) return;

  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(LEGACY_RECORD_STORE, "readwrite");
      const store = transaction.objectStore(LEGACY_RECORD_STORE);
      parsed
        .filter((item): item is LegacyCheckIn & { date: string } =>
          Boolean(item.date),
        )
        .forEach((item) => {
          store.put({
            id: item.id ?? crypto.randomUUID(),
            date: item.date,
            attention: item.attention ?? item.topic ?? "AI 学习记录",
            sourceUrl: item.sourceUrl ?? "",
            summary: item.summary ?? item.note ?? "",
            inspiration: item.inspiration ?? "",
            imageName: item.imageName ?? "",
            imageDataUrl: item.imageDataUrl ?? "",
          });
        });
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("旧记录迁移失败"));
      transaction.oncomplete = () => resolve();
    });
  } finally {
    database.close();
  }
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

async function migrateAnonymousRecords(userId: string) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [LEGACY_RECORD_STORE, USER_RECORD_STORE],
        "readwrite",
      );
      const legacyStore = transaction.objectStore(LEGACY_RECORD_STORE);
      const userStore = transaction.objectStore(USER_RECORD_STORE);
      const request = legacyStore.getAll();
      request.onerror = () =>
        reject(request.error ?? new Error("旧记录迁移失败"));
      request.onsuccess = () => {
        (request.result as CheckIn[]).forEach((record) => {
          userStore.put({ ...record, userId } satisfies StoredCheckIn);
        });
        legacyStore.clear();
      };
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("旧记录迁移失败"));
      transaction.oncomplete = () => resolve();
    });
  } finally {
    database.close();
  }
}

async function compressImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取图片"));
    });

    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片");

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function playCheckInChime() {
  if (!window.AudioContext) return;
  const audioContext = new AudioContext();
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.45);
  gain.connect(audioContext.destination);

  [784, 1174].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(audioContext.currentTime + index * 0.08);
    oscillator.stop(audioContext.currentTime + 0.42);
  });

  window.setTimeout(() => void audioContext.close(), 600);
}

function launchCelebration() {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (reducedMotion) return false;

  const colors = ["#14755f", "#ef654f", "#f0c54d", "#315e8a", "#ffffff"];
  confetti({
    particleCount: 110,
    spread: 82,
    startVelocity: 42,
    origin: { y: 0.72 },
    colors,
  });

  const endAt = Date.now() + 1500;
  function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 62,
      origin: { x: 0, y: 0.72 },
      colors,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 62,
      origin: { x: 1, y: 0.72 },
      colors,
    });
    if (Date.now() < endAt) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return true;
}

function LoginScreen({
  profiles,
  onLogin,
  onRegister,
}: {
  profiles: UserProfile[];
  onLogin: (profile: UserProfile) => void;
  onRegister: (name: string, avatarId: number) => Promise<void>;
}) {
  const [showRegister, setShowRegister] = useState(profiles.length === 0);
  const [name, setName] = useState("");
  const [avatarId, setAvatarId] = useState(1);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await onRegister(name, avatarId);
    } catch (registerError) {
      setError(
        registerError instanceof Error ? registerError.message : "注册失败",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-shell">
        <div className="login-brand">
          <p className="eyebrow">AI LEARNING JOURNAL</p>
          <h1>
            今天你<span>attention</span>了吗？
          </h1>
          <p>给每天的学习留一个名字，也给自己留一个位置。</p>
        </div>

        <section className="login-panel" aria-labelledby="login-title">
          {showRegister ? (
            <>
              <div className="login-panel-heading">
                <span className="login-step">01</span>
                <div>
                  <h2 id="login-title">创建你的学习身份</h2>
                  <p>名称将用于区分每个人的打卡记录。</p>
                </div>
              </div>
              <form className="register-form" onSubmit={handleRegister}>
                <label className="name-field">
                  <span>名称</span>
                  <input
                    autoFocus
                    maxLength={20}
                    placeholder="输入一个好记的名称"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <small>{Array.from(name).length}/20</small>
                </label>

                <fieldset className="avatar-fieldset">
                  <legend>选择头像</legend>
                  <div className="avatar-options">
                    {AVATAR_IDS.map((option) => (
                      <label
                        className={`avatar-option${avatarId === option ? " selected" : ""}`}
                        key={option}
                      >
                        <input
                          type="radio"
                          name="avatar"
                          value={option}
                          checked={avatarId === option}
                          onChange={() => setAvatarId(option)}
                        />
                        <img src={avatarPath(option)} alt={`头像 ${option}`} />
                        {avatarId === option ? (
                          <i aria-hidden="true"><Check size={14} strokeWidth={3} /></i>
                        ) : null}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {error ? (
                  <p className="login-error" role="alert">{error}</p>
                ) : null}

                <div className="register-actions">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={isSubmitting || !name.trim()}
                  >
                    {isSubmitting ? "正在创建…" : "注册并进入"}
                  </button>
                  {profiles.length > 0 ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setError("");
                        setShowRegister(false);
                      }}
                    >
                      返回已有用户
                    </button>
                  ) : null}
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="login-panel-heading">
                <span className="login-step">02</span>
                <div>
                  <h2 id="login-title">选择名称登录</h2>
                  <p>继续上一次留下的 attention。</p>
                </div>
              </div>
              <div className="profile-list">
                {profiles.map((profile) => (
                  <button
                    className="profile-login"
                    type="button"
                    onClick={() => onLogin(profile)}
                    key={profile.name}
                  >
                    <img
                      src={avatarPath(profile.avatarId)}
                      alt=""
                    />
                    <span>
                      <strong>{profile.name}</strong>
                      <small>进入学习记录</small>
                    </span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <button
                className="new-profile-button"
                type="button"
                onClick={() => {
                  setName("");
                  setAvatarId(1);
                  setError("");
                  setShowRegister(true);
                }}
              >
                <UserPlus size={18} />
                注册新的名称
              </button>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

export function AttentionApp() {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadProfiles() {
      try {
        const storedProfiles = await getUserProfiles();
        const storedName = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);
        const storedUser =
          storedProfiles.find((profile) => profile.name === storedName) ?? null;
        if (cancelled) return;
        setProfiles(storedProfiles);
        setCurrentUser(storedUser);
      } finally {
        if (!cancelled) setIsAuthLoading(false);
      }
    }
    void loadProfiles();
    return () => {
      cancelled = true;
    };
  }, []);

  function login(profile: UserProfile) {
    window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, profile.name);
    setCurrentUser(profile);
  }

  async function register(name: string, avatarId: number) {
    const isFirstProfile = profiles.length === 0;
    const profile = await registerUserProfile(name, avatarId);
    if (isFirstProfile) {
      await migrateLegacyCheckIns();
      await migrateAnonymousRecords(profile.name);
    }
    setProfiles((current) => [...current, profile]);
    login(profile);
  }

  function logout() {
    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    setCurrentUser(null);
  }

  if (isAuthLoading) {
    return (
      <main className="auth-loading-page">
        <div className="auth-loading-mark">attention</div>
        <p>正在打开你的学习空间…</p>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <LoginScreen
        profiles={profiles}
        onLogin={login}
        onRegister={register}
      />
    );
  }

  return (
    <JournalWorkspace
      key={currentUser.name}
      user={currentUser}
      onLogout={logout}
    />
  );
}

function JournalWorkspace({
  user,
  onLogout,
}: {
  user: UserProfile;
  onLogout: () => void;
}) {
  const today = getTodayKey();
  const [now] = useState(() => new Date());
  const [records, setRecords] = useState<CheckIn[]>([]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [calendarDate, setCalendarDate] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("neutral");
  const [imageInputKey, setImageInputKey] = useState(0);
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [isLogoutPending, setIsLogoutPending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await migrateLegacyCheckIns();
        const nextRecords = await getStoredCheckIns(user.name);

        if (cancelled) return;
        setRecords(nextRecords);
        setDraft(draftFromRecord(nextRecords.find((item) => item.date === today)));
        setIsMuted(window.localStorage.getItem(MUTE_STORAGE_KEY) === "true");
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "记录加载失败");
          setMessageTone("error");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [today, user.name]);

  const streak = useMemo(() => calculateStreak(records), [records]);
  const selectedRecord = records.find((item) => item.date === selectedDate);
  const hasTodayRecord = records.some((item) => item.date === today);
  const totalRecords = records.length;
  const isDirty =
    draftSignature(draft) !== draftSignature(draftFromRecord(selectedRecord));

  const calendar = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const recordMap = new Map(records.map((item) => [item.date, item]));

    return {
      year,
      month,
      firstWeekday,
      isCurrentMonth:
        year === now.getFullYear() && month === now.getMonth(),
      days: Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const date = getDateKey(year, month, day);
        return {
          day,
          date,
          today: date === today,
          selected: date === selectedDate,
          record: recordMap.get(date),
        };
      }),
    };
  }, [calendarDate, now, records, selectedDate, today]);

  function setStatus(messageText: string, tone: MessageTone = "neutral") {
    setMessage(messageText);
    setMessageTone(tone);
  }

  function openDate(date: string) {
    const record = records.find((item) => item.date === date);
    setSelectedDate(date);
    setDraft(draftFromRecord(record));
    setPendingDate(null);
    setStatus(
      record
        ? `已打开${formatDate(date)}的学习记录`
        : `${formatDate(date)}还没有记录`,
    );
    window.requestAnimationFrame(() => {
      document.getElementById("entry-editor")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }

  function requestDateChange(date: string) {
    if (date === selectedDate) {
      openDate(date);
      return;
    }
    if (isDirty) {
      setPendingDate(date);
      return;
    }
    openDate(date);
  }

  function selectToday() {
    setCalendarDate(new Date(now.getFullYear(), now.getMonth(), 1));
    requestDateChange(today);
  }

  async function saveCurrentRecord() {
    const attention = draft.attention.trim();
    const summary = draft.summary.trim();
    if (!attention || !summary) {
      setStatus("请先填写今日 attention 和知识点小结", "error");
      return false;
    }

    const isFirstCheckIn = !selectedRecord;
    setIsSaving(true);
    setStatus("正在写入这一天…");
    try {
      const nextRecord: CheckIn = {
        id: selectedRecord?.id ?? crypto.randomUUID(),
        date: selectedDate,
        attention,
        sourceUrl: draft.sourceUrl.trim(),
        summary,
        inspiration: draft.inspiration.trim(),
        imageName: draft.removeImage ? "" : draft.imageName,
        imageDataUrl: draft.removeImage ? "" : draft.imageDataUrl,
      };
      await saveStoredCheckIn(user.name, nextRecord);

      setRecords((current) =>
        [
          nextRecord,
          ...current.filter((item) => item.date !== selectedDate),
        ].sort((left, right) => right.date.localeCompare(left.date)),
      );
      setDraft(draftFromRecord(nextRecord));
      setImageInputKey((current) => current + 1);
      setStatus(
        isFirstCheckIn
          ? `${formatDate(selectedDate)}打卡完成`
          : `${formatDate(selectedDate)}的修改已保存`,
        "success",
      );

      if (isFirstCheckIn) {
        if (!isMuted) playCheckInChime();
        const animated = launchCelebration();
        setIsCelebrating(true);
        window.setTimeout(() => setIsCelebrating(false), animated ? 1900 : 900);
      }
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败", "error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveCurrentRecord();
  }

  async function saveAndSwitch() {
    const saved = await saveCurrentRecord();
    if (saved && pendingDate) openDate(pendingDate);
  }

  async function processImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setStatus("请选择 10MB 以内的图片", "error");
      return;
    }

    setStatus("正在整理图片笔记…");
    try {
      const imageDataUrl = await compressImage(file);
      setDraft((current) => ({
        ...current,
        imageDataUrl,
        imageName: file.name,
        removeImage: false,
      }));
      setStatus("图片笔记已加入，记得完成保存");
    } catch {
      setStatus("图片读取失败，请换一张重试", "error");
    }
  }

  function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    void processImage(event.target.files?.[0]);
  }

  function handleImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void processImage(event.dataTransfer.files?.[0]);
  }

  function toggleMuted() {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    window.localStorage.setItem(MUTE_STORAGE_KEY, String(nextMuted));
    setStatus(nextMuted ? "打卡提示音已关闭" : "打卡提示音已开启");
  }

  function requestLogout() {
    if (isDirty) {
      setIsLogoutPending(true);
      return;
    }
    onLogout();
  }

  async function saveAndLogout() {
    const saved = await saveCurrentRecord();
    if (saved) onLogout();
  }

  const previewImage = draft.removeImage ? "" : draft.imageDataUrl;
  const editorState = isDirty
    ? "未保存"
    : selectedRecord
      ? "已保存"
      : "待填写";
  const canSave = Boolean(draft.attention.trim() && draft.summary.trim());

  return (
    <main className="app-page">
      <section className="page-shell">
        <header className={`app-header${isCelebrating ? " celebrating" : ""}`}>
          <div className="header-copy">
            <div className="header-topline">
              <p className="eyebrow">AI LEARNING JOURNAL · {formatDate(today)}</p>
              <div className="current-account">
                <img src={avatarPath(user.avatarId)} alt="" />
                <strong>{user.name}</strong>
                <button
                  className="account-logout"
                  type="button"
                  title="退出当前用户"
                  aria-label="退出当前用户"
                  onClick={requestLogout}
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>
            <h1>
              今天你<span>attention</span>了吗？
            </h1>
            <p className="hero-copy">每天留下一点新知，慢慢长成自己的知识地图。</p>
          </div>

          <div className="header-dashboard">
            <button
              className="icon-button sound-button"
              type="button"
              title={isMuted ? "开启打卡提示音" : "关闭打卡提示音"}
              aria-label={isMuted ? "开启打卡提示音" : "关闭打卡提示音"}
              onClick={toggleMuted}
            >
              {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>

            <div className={`today-summary${hasTodayRecord ? " complete" : ""}`}>
              <span className="status-mark" aria-hidden="true">
                {hasTodayRecord ? <Check size={15} strokeWidth={3} /> : null}
              </span>
              <div>
                <small>今天</small>
                <strong>{hasTodayRecord ? "已经打卡" : "等待 attention"}</strong>
              </div>
            </div>

            <div className="metric-row" aria-label="学习统计">
              <div>
                <span>连续专注</span>
                <strong>{streak}<small>天</small></strong>
              </div>
              <div>
                <span>累计记录</span>
                <strong>{totalRecords}<small>篇</small></strong>
              </div>
            </div>

            <button className="today-button" type="button" onClick={selectToday}>
              <CalendarDays size={18} />
              {hasTodayRecord ? "回看今日记录" : "开始今日打卡"}
            </button>
          </div>
        </header>

        <section className="calendar-section" aria-labelledby="calendar-title">
          <div className="calendar-heading">
            <div>
              <p className="eyebrow">ATTENTION MAP</p>
              <h2 id="calendar-title">
                {new Intl.DateTimeFormat("zh-CN", {
                  year: "numeric",
                  month: "long",
                }).format(calendarDate)}
              </h2>
              <p className="section-description">选一天，记录或回看当日的学习收获</p>
            </div>
            <div className="calendar-actions">
              <button
                className="icon-button"
                type="button"
                aria-label="上个月"
                title="上个月"
                onClick={() =>
                  setCalendarDate(new Date(calendar.year, calendar.month - 1, 1))
                }
              >
                <ChevronLeft size={19} />
              </button>
              {!calendar.isCurrentMonth ? (
                <button
                  type="button"
                  className="month-reset"
                  onClick={() =>
                    setCalendarDate(new Date(now.getFullYear(), now.getMonth(), 1))
                  }
                >
                  回到本月
                </button>
              ) : null}
              <button
                className="icon-button"
                type="button"
                aria-label="下个月"
                title="下个月"
                onClick={() =>
                  setCalendarDate(new Date(calendar.year, calendar.month + 1, 1))
                }
              >
                <ChevronRight size={19} />
              </button>
            </div>
          </div>

          <div className="calendar-weekdays" aria-hidden="true">
            {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid" role="grid" aria-label="月度学习日历">
            {Array.from({ length: calendar.firstWeekday }, (_, index) => (
              <span
                className="calendar-cell blank"
                aria-hidden="true"
                key={`blank-${index}`}
              />
            ))}
            {calendar.days.map((item) => (
              <button
                type="button"
                role="gridcell"
                aria-selected={item.selected}
                className={`calendar-cell${item.record ? " recorded" : ""}${item.today ? " today" : ""}${item.selected ? " selected" : ""}`}
                aria-label={`${item.day}日${item.record ? `，已保存：${item.record.attention}` : "，暂无记录"}`}
                onClick={() => requestDateChange(item.date)}
                key={item.date}
              >
                <span className="calendar-cell-top">
                  <b>{item.day}</b>
                  {item.record ? (
                    <i aria-hidden="true"><Check size={13} strokeWidth={3} /></i>
                  ) : null}
                </span>
                <small>{item.record?.attention ?? (item.today ? "记录今天" : "")}</small>
                {item.today ? <em>今天</em> : null}
              </button>
            ))}
          </div>
          <div className="calendar-legend">
            <span><i className="legend-dot recorded-dot" />已打卡</span>
            <span><i className="legend-dot selected-dot" />当前选中</span>
            <span><i className="legend-dot today-dot" />今天</span>
          </div>
        </section>

        <section className="editor-section" id="entry-editor" aria-labelledby="editor-title">
          <div className="editor-heading-bar">
            <div className="editor-heading-copy">
              <p className="eyebrow">DAILY ATTENTION</p>
              <h2 id="editor-title">{formatDate(selectedDate)}</h2>
              <p className="section-description">
                {selectedRecord ? "回看并补充这一天的理解" : "从一句话开始，完成一次轻量复盘"}
              </p>
            </div>
            <div className="editor-statuses">
              <span className={`editor-state${isDirty ? " dirty" : ""}`}>
                {editorState}
              </span>
              <span className={`checkin-state${selectedRecord ? " complete" : ""}`}>
                {selectedRecord ? <Check size={14} strokeWidth={3} /> : null}
                {selectedRecord ? "已打卡" : "待打卡"}
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="loading-state" aria-label="正在读取学习记录">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <form className="checkin-form" onSubmit={handleSubmit}>
              <div className="form-grid">
                <label>
                  <span className="label-row">
                    <b>今日 attention</b>
                    <em>必填</em>
                  </span>
                  <span className="field-hint">用一句话总结当天学习的内容</span>
                  <input
                    maxLength={80}
                    placeholder="例如：理解了 Transformer 中的注意力机制"
                    value={draft.attention}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        attention: event.target.value,
                      }))
                    }
                  />
                  <span className="character-count">{draft.attention.length}/80</span>
                </label>

                <label>
                  <span className="label-row"><b>学习资料来源</b></span>
                  <span className="field-hint">文章、视频、课程或工具链接</span>
                  <input
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={draft.sourceUrl}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        sourceUrl: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <div className="reflection-layout">
                <label className="summary-field">
                  <span className="label-row">
                    <b>学习知识点小结</b>
                    <em>必填</em>
                  </span>
                  <span className="field-hint">写下关键概念、你的理解，以及还没想明白的问题</span>
                  <textarea
                    maxLength={500}
                    placeholder="今天真正理解了什么？试着用自己的话讲一遍。"
                    value={draft.summary}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        summary: event.target.value,
                      }))
                    }
                  />
                  <span className="character-count">{draft.summary.length}/500</span>
                </label>

                <div className="secondary-fields">
                  <div
                    className={`upload-field${isDragging ? " dragging" : ""}${previewImage ? " has-image" : ""}`}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                        setIsDragging(false);
                      }
                    }}
                    onDrop={handleImageDrop}
                  >
                    {previewImage ? (
                      <div className="image-preview">
                        <img
                          src={previewImage}
                          alt={draft.imageName || "学习图片笔记"}
                        />
                        <div className="image-actions">
                          <span>{draft.imageName || "图片笔记"}</span>
                          <div>
                            <label className="small-icon-button" title="替换图片">
                              <input
                                key={imageInputKey}
                                type="file"
                                accept="image/*"
                                onChange={handleImageUpload}
                              />
                              <ImagePlus size={17} />
                            </label>
                            <button
                              className="small-icon-button danger"
                              type="button"
                              title="移除图片"
                              aria-label="移除图片"
                              onClick={() => {
                                setDraft((current) => ({
                                  ...current,
                                  imageDataUrl: "",
                                  imageName: "",
                                  removeImage: true,
                                }));
                                setImageInputKey((current) => current + 1);
                              }}
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <label className="upload-dropzone">
                        <input
                          key={imageInputKey}
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                        />
                        <span className="upload-icon" aria-hidden="true">
                          {isDragging ? <Upload size={22} /> : <ImagePlus size={22} />}
                        </span>
                        <b>{isDragging ? "松手添加图片" : "添加图片笔记"}</b>
                        <small>点击或拖入脑图、手写笔记、截图 · 最大 10MB</small>
                      </label>
                    )}
                  </div>

                  <label className="inspiration-field">
                    <span className="label-row"><b>灵感记录</b></span>
                    <span className="field-hint">它让你联想到了什么？接下来想试试什么？</span>
                    <textarea
                      maxLength={300}
                      placeholder="记下一闪而过的想法…"
                      value={draft.inspiration}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          inspiration: event.target.value,
                        }))
                      }
                    />
                    <span className="character-count">{draft.inspiration.length}/300</span>
                  </label>
                </div>
              </div>

              <div className="form-actions">
                <div className="action-buttons">
                  <button
                    className="primary-button"
                    disabled={
                      isSaving || !canSave
                    }
                    type="submit"
                  >
                    {isSaving ? (
                      "正在保存…"
                    ) : selectedRecord ? (
                      "保存修改"
                    ) : (
                      <>
                        <span aria-hidden="true">叮</span>
                        一下，完成打卡
                      </>
                    )}
                  </button>
                  <button
                    className="icon-button reset-button"
                    type="button"
                    title="还原未保存的修改"
                    aria-label="还原未保存的修改"
                    disabled={!isDirty}
                    onClick={() => {
                      setDraft(draftFromRecord(selectedRecord));
                      setStatus("已还原未保存的修改");
                    }}
                  >
                    <RotateCcw size={18} />
                  </button>
                </div>
                <div className="save-status">
                  <span className={`save-message ${messageTone}`} role="status" aria-live="polite">
                    {message || (isDirty ? "有修改尚未保存" : "记录仅保存在当前浏览器")}
                  </span>
                  <small>仅此浏览器</small>
                </div>
              </div>
            </form>
          )}
        </section>
      </section>

      {isCelebrating ? (
        <div className="celebration-banner" role="status" aria-live="polite">
          <span><Check size={18} strokeWidth={3} /></span>
          这一天的 attention 已收下
        </div>
      ) : null}

      {pendingDate ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="switch-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="switch-dialog-title"
          >
            <button
              className="dialog-close icon-button"
              type="button"
              aria-label="关闭"
              onClick={() => setPendingDate(null)}
            >
              <X size={18} />
            </button>
            <p className="eyebrow">UNSAVED ATTENTION</p>
            <h2 id="switch-dialog-title">这一天还有修改没有保存</h2>
            <p>
              {canSave
                ? `先处理当前内容，再打开${formatDate(pendingDate)}。`
                : "补全必填内容后保存，或放弃当前修改后继续。"}
            </p>
            <div className="dialog-actions">
              <button
                className="primary-button"
                type="button"
                disabled={isSaving || !canSave}
                onClick={() => void saveAndSwitch()}
              >
                保存并切换
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => openDate(pendingDate)}
              >
                放弃修改
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => setPendingDate(null)}
              >
                取消
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isLogoutPending ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="switch-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-dialog-title"
          >
            <button
              className="dialog-close icon-button"
              type="button"
              aria-label="关闭"
              onClick={() => setIsLogoutPending(false)}
            >
              <X size={18} />
            </button>
            <p className="eyebrow">UNSAVED ATTENTION</p>
            <h2 id="logout-dialog-title">退出前还有修改没有保存</h2>
            <p>
              {canSave
                ? "保存当前内容后退出，或放弃这次修改。"
                : "补全必填内容后保存，或直接放弃这次修改。"}
            </p>
            <div className="dialog-actions">
              <button
                className="primary-button"
                type="button"
                disabled={isSaving || !canSave}
                onClick={() => void saveAndLogout()}
              >
                保存并退出
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={onLogout}
              >
                放弃修改并退出
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => setIsLogoutPending(false)}
              >
                取消
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
