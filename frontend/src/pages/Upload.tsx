import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import PageHeader from "../components/ui/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import StatusBadge from "../components/ui/StatusBadge";

type Group = {
  id: number;
  name: string;
};

type Student = {
  id: number;
  full_name: string;
  group_id: number;
};

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [groupId, setGroupId] = useState<number | "">("");
  const [studentId, setStudentId] = useState<number | "">("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "">("");

  const selectStyle: React.CSSProperties = {
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    backgroundImage: "none",
    paddingRight: "14px",
  };

  async function loadGroups() {
    const res = await api.get("/groups");
    setGroups(Array.isArray(res.data) ? res.data : []);
  }

  async function loadStudents(selectedGroupId: number) {
    const res = await api.get(`/students?group_id=${selectedGroupId}`);
    setStudents(Array.isArray(res.data) ? res.data : []);
  }

  useEffect(() => {
    loadGroups().catch(() => {});
  }, []);

  useEffect(() => {
    if (groupId === "") {
      setStudents([]);
      setStudentId("");
      return;
    }

    loadStudents(Number(groupId)).catch(() => {
      setStudents([]);
    });
  }, [groupId]);

  const selectedGroupName = useMemo(() => {
    if (groupId === "") return "Не выбрана";
    return groups.find((g) => g.id === Number(groupId))?.name || "Не выбрана";
  }, [groupId, groups]);

  async function handleUpload() {
    if (!file) {
      setMessageType("error");
      setMessage("Выберите файл");
      return;
    }

    setLoading(true);
    setMessage("");
    setMessageType("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      if (displayName.trim()) {
        formData.append("display_name", displayName.trim());
      }

      if (studentId !== "") {
        formData.append("student_id", String(studentId));
      }

      await api.post("/documents/upload", formData);

      setMessageType("success");
      setMessage("Документ успешно загружен");
      setFile(null);
      setDisplayName("");
      setGroupId("");
      setStudentId("");
      setStudents([]);

      const input = document.getElementById("upload-file-input") as HTMLInputElement | null;
      if (input) {
        input.value = "";
      }
    } catch (e: any) {
      setMessageType("error");
      setMessage(e?.response?.data?.detail || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title="Загрузка документа"
        subtitle="Загрузка личных и общих документов с ручной или автоматической привязкой."
      />

      {message ? (
        <div
          className="card section-card"
          style={
            messageType === "success"
              ? {
                  background: "rgba(22, 163, 74, 0.16)",
                  borderColor: "rgba(22, 163, 74, 0.28)",
                  color: "#bbf7d0",
                }
              : {
                  background: "rgba(239, 68, 68, 0.16)",
                  borderColor: "rgba(239, 68, 68, 0.28)",
                  color: "#fecaca",
                }
          }
        >
          {message}
        </div>
      ) : null}

      <div className="grid-2">
        <div className="card section-card">
          <div className="page-header" style={{ marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Файл и параметры</h3>
              <p className="page-subtitle" style={{ marginTop: 6 }}>
                Выбери документ и укажи данные для удобной привязки
              </p>
            </div>
          </div>

          <div className="form-grid">
            <div>
              <label className="label">Файл</label>

              <label
                htmlFor="upload-file-input"
                style={{
                  display: "block",
                  border: "1px dashed rgba(99, 102, 241, 0.35)",
                  borderRadius: 18,
                  padding: 18,
                  background: "rgba(15, 23, 42, 0.45)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {file ? file.name : "Нажми, чтобы выбрать файл"}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>
                  Поддерживаются PDF, DOCX, TXT и другие типы, которые обрабатывает backend
                </div>
              </label>

              <input
                id="upload-file-input"
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ display: "none" }}
              />
            </div>

            <div>
              <label className="label">Название документа</label>
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Например: Социальный паспорт"
              />
            </div>

            <div>
              <label className="label">Группа</label>
              <select
                className="select"
                style={selectStyle}
                value={groupId}
                onChange={(e) =>
                  setGroupId(e.target.value === "" ? "" : Number(e.target.value))
                }
              >
                <option value="">Выберите группу</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Студент</label>
              <select
                className="select"
                style={selectStyle}
                value={studentId}
                onChange={(e) =>
                  setStudentId(e.target.value === "" ? "" : Number(e.target.value))
                }
              >
                <option value="">Не выбирать</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={loading}
              >
                {loading ? "Загрузка..." : "Загрузить документ"}
              </button>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card section-card">
            <div className="page-header" style={{ marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>Как работает привязка</h3>
                <p className="page-subtitle" style={{ marginTop: 6 }}>
                  Краткая логика загрузки документа
                </p>
              </div>
            </div>

            <div className="info-list">
              <div className="info-item">
                <span className="info-item-label">Если выбран студент</span>
                <span className="info-item-value">Ручная привязка</span>
              </div>
              <div className="info-item">
                <span className="info-item-label">Если студент не выбран</span>
                <span className="info-item-value">AI / группа</span>
              </div>
              <div className="info-item">
                <span className="info-item-label">Выбранная группа</span>
                <span className="info-item-value">{selectedGroupName}</span>
              </div>
              <div className="info-item">
                <span className="info-item-label">Текущий файл</span>
                <span className="info-item-value">{file ? file.name : "Не выбран"}</span>
              </div>
            </div>
          </div>

          <div className="card section-card">
            <div className="page-header" style={{ marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>Тип загрузки</h3>
                <p className="page-subtitle" style={{ marginTop: 6 }}>
                  Система определяет сценарий автоматически
                </p>
              </div>
            </div>

            <div className="row">
              <StatusBadge
                status={studentId !== "" ? "personal" : "shared"}
                text={studentId !== "" ? "Личный документ" : "Авто / общий"}
              />
              {file ? <StatusBadge status="processed" text="Файл выбран" /> : null}
            </div>

            {!file ? (
              <div style={{ marginTop: 16 }}>
                <EmptyState
                  title="Файл ещё не выбран"
                  description="Выбери документ слева, чтобы подготовить загрузку."
                  icon={<span>📤</span>}
                />
              </div>
            ) : (
              <div
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 16,
                  background: "rgba(148, 163, 184, 0.06)",
                  border: "1px solid rgba(148, 163, 184, 0.10)",
                }}
              >
                <div style={{ fontWeight: 600 }}>{file.name}</div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
                  Размер: {(file.size / 1024).toFixed(1)} KB
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                  Тип: {file.type || "Не определён"}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}