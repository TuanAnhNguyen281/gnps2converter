import type { TokenPreview } from "./types";

const fmt = (n: number) => n.toLocaleString("vi-VN");

// Why a fresh conversation would help, or null while this one is still fine.
export function newChatReason(preview: TokenPreview) {
  const window = Math.max(1, preview.contextLimit - preview.outputMax),
    used = preview.input / window,
    turns = preview.history.included / 2,
    dropped = preview.history.omitted / 2;
  if (dropped > 0)
    return `${dropped} lượt cũ không còn gửi nguyên văn (chỉ còn trích đoạn), AI có thể quên chi tiết trước đó.`;
  if (used >= 0.7)
    return `Đã dùng ${Math.round(used * 100)}% context của model; các lượt tiếp theo sẽ phải cắt bớt lịch sử.`;
  if (turns >= 8 && preview.breakdown.history >= preview.input * 0.5)
    return `Lịch sử ${turns} lượt chiếm hơn nửa token mỗi câu hỏi, làm tốn hạn mức.`;
  return null;
}

export function ContextMeter({
  preview,
  dismissed,
  disabled,
  onDismiss,
  onNewChat,
}: {
  preview: TokenPreview;
  dismissed: boolean;
  disabled: boolean;
  onDismiss: () => void;
  onNewChat: () => void;
}) {
  const window = Math.max(1, preview.contextLimit - preview.outputMax),
    percent = Math.min(100, Math.round((preview.input / window) * 100)),
    reason = newChatReason(preview);
  return (
    <div className="context-meter" aria-label="Context hội thoại">
      <div className="quota-meter">
        <div className={percent >= 70 ? "warn" : ""}>
          <span>
            Context: ~{fmt(preview.input)} / {fmt(window)} token ({percent}%) ·{" "}
            {preview.history.included / 2} lượt gần nhất
            {preview.history.omitted
              ? ` + ${preview.history.omitted / 2} lượt tóm tắt`
              : ""}
          </span>
          <progress max={100} value={percent} />
        </div>
      </div>
      {reason && !dismissed && (
        <div className="new-chat-hint" role="status">
          <span>
            <b>Nên bắt đầu hội thoại mới.</b> {reason}
          </span>
          <div className="ai-actions">
            <button type="button" disabled={disabled} onClick={onNewChat}>
              Tạo hội thoại mới
            </button>
            <button type="button" onClick={onDismiss}>
              Để sau
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
