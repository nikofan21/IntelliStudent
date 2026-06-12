import { useEffect } from "react";
import { createPortal } from "react-dom";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

export default function ConfirmModal({
  open,
  title,
  description,
  confirmText = "Подтвердить",
  cancelText = "Отмена",
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, loading, onClose]);

  if (!open) return null;

  const accentColor = danger ? "#ef4444" : "#3b82f6";
  const accentSoft = danger
    ? "rgba(239, 68, 68, 0.16)"
    : "rgba(59, 130, 246, 0.16)";
  const borderColor = danger
    ? "rgba(239, 68, 68, 0.35)"
    : "rgba(59, 130, 246, 0.35)";
  const glow = danger
    ? "0 0 0 1px rgba(239, 68, 68, 0.28), 0 0 24px rgba(239, 68, 68, 0.14)"
    : "0 0 0 1px rgba(59, 130, 246, 0.28), 0 0 24px rgba(59, 130, 246, 0.14)";

  const modal = (
    <div
      onClick={!loading ? onClose : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        background: "rgba(3, 8, 20, 0.72)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "520px",
          borderRadius: "20px",
          border: `1px solid ${borderColor}`,
          background:
            "linear-gradient(180deg, rgba(20, 25, 39, 0.98) 0%, rgba(12, 16, 27, 0.98) 100%)",
          boxShadow: `0 24px 80px rgba(0, 0, 0, 0.45), ${glow}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "22px 22px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "flex-start",
            gap: "14px",
          }}
        >
          <div
            style={{
              flexShrink: 0,
              width: "42px",
              height: "42px",
              borderRadius: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: accentSoft,
              border: `1px solid ${borderColor}`,
              color: accentColor,
              fontSize: "20px",
              fontWeight: 700,
            }}
          >
            !
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                color: "#f8fafc",
                fontSize: "20px",
                fontWeight: 700,
                lineHeight: 1.25,
                marginBottom: "8px",
              }}
            >
              {title}
            </div>

            <div
              style={{
                color: "rgba(226, 232, 240, 0.82)",
                fontSize: "14px",
                lineHeight: 1.6,
                whiteSpace: "pre-line",
              }}
            >
              {description}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "18px 22px 22px",
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              minWidth: "120px",
              height: "44px",
              padding: "0 18px",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.04)",
              color: "#e2e8f0",
              fontSize: "14px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
              transition: "0.2s ease",
            }}
          >
            {cancelText}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            style={{
              minWidth: "160px",
              height: "44px",
              padding: "0 18px",
              borderRadius: "12px",
              border: `1px solid ${borderColor}`,
              background: accentSoft,
              color: accentColor,
              fontSize: "14px",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
              transition: "0.2s ease",
            }}
          >
            {loading ? "Выполняем..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}