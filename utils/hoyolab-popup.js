const pad = (value) => String(value).padStart(2, "0");

const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const sameDay = (left, right) =>
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate();

export const formatCheckinTime = (timestamp, now = new Date()) => {
  if (!Number.isFinite(timestamp)) {
    return "尚无记录";
  }
  const date = new Date(timestamp);
  if (sameDay(date, now)) {
    return `今天 ${clock(date)}`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(date, tomorrow)) {
    return `明天 ${clock(date)}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock(date)}`;
};

const successful = (result) => result.status === "signed" || result.status === "already-signed";

export const buildCheckinView = (state, now = new Date()) => {
  const last = formatCheckinTime(state?.lastRunAt, now);
  const next = state?.enabled ? (Number.isFinite(state?.nextRunAt) ? formatCheckinTime(state.nextRunAt, now) : "等待计划") : "不自动运行";
  const base = { last, next, action: "立即检查签到", busy: false };

  if (!state?.enabled) {
    return {
      ...base,
      tone: "paused",
      chip: "已暂停",
      title: "自动签到已关闭",
      detail: "不会按计划运行，仍可手动检查",
    };
  }

  if (state.status === "running") {
    return {
      ...base,
      tone: "running",
      chip: "正在运行",
      title: "正在检查签到",
      detail: "正在检查 3 个游戏 · 请稍候",
      action: "正在签到…",
      busy: true,
    };
  }

  if (state.status === "login-required") {
    const count = state.results?.filter((result) => result.status === "login-required").length || 3;
    return {
      ...base,
      tone: "warning",
      chip: "需要处理",
      title: "需要登录 HoYoLAB",
      detail: `账号会话已失效 · ${count} 个游戏未完成`,
      action: "重新检查登录",
    };
  }

  if (state.status === "failed") {
    const count = state.results?.filter((result) => result.status === "failed").length || 1;
    return {
      ...base,
      tone: "error",
      chip: "需要处理",
      title: "签到遇到问题",
      detail: `${count} 个游戏检查失败 · 可再次尝试`,
      action: "重新检查签到",
    };
  }

  if (state.status === "success") {
    const count = state.results?.filter(successful).length || 0;
    const completedAt = Number.isFinite(state.lastRunAt) ? clock(new Date(state.lastRunAt)) : "--:--";
    return {
      ...base,
      tone: "success",
      chip: "运行正常",
      title: "今日已签到",
      detail: `${completedAt} 完成 · ${count} 个游戏成功`,
    };
  }

  return {
    ...base,
    tone: "idle",
    chip: "运行正常",
    title: "尚未运行",
    detail: "等待首次自动检查或立即检查",
  };
};
