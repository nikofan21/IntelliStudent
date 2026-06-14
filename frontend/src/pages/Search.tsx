import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import PageHeader from "../components/ui/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import StatusBadge from "../components/ui/StatusBadge";
import ConfirmModal from "../components/ui/ConfirmModal";
import RenameModal from "../components/ui/RenameModal";

type Group = {
  id: number;
  name: string;
  display_name: string;
  department_id?: number | null;
  department_name?: string | null;
};

type Department = {
  id: number;
  name: string;
  description?: string | null;
  is_active?: boolean;
};

type SearchDoc = {
  doc_id: number;
  filename: string;
  display_name?: string | null;
  effective_name?: string;
  file_type: string;
  status: string;
  uploaded_at: string;
  text_preview: string;
  download_url: string;
  student_profile_url?: string | null;
  match_source?: string;
  linked_students_count?: number;
  is_shared?: boolean;
  document_scope?: "shared" | "personal" | string;
  ai?: { doc_type?: string | null; entities_json?: string | null } | null;
};

type SearchStudent = {
  id: number;
  full_name: string;
  group_id: number;
  group_name?: string;
  course: number;
  email: string;
  documents: SearchDoc[];
};

type SearchResult = {
  group_id: number;
  group: string;
  group_display_name: string;
  count?: number;
  students: SearchStudent[];
};

type AnalyticsDocument = {
  doc_id: number;
  filename: string;
  display_name?: string | null;
  matched_fragment: string;
};

type AnalyticsStudent = {
  student_id: number;
  full_name: string;
  group_id: number;
  group_name?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  documents: AnalyticsDocument[];
};

type AnalyticsResult = {
  query: string;
  count: number;
  students: AnalyticsStudent[];
};

type StudentProfileResponse = {
  document_id: number;
  student_id: number;
  student_full_name: string;
  group_name?: string;
  course?: number;
  profile: {
    found: boolean;
    match_type?: string | null;
    reason?: string | null;
    table_index?: number | null;
    row_index?: number | null;
    headers?: string[];
    row_data?: Record<string, string> | null;
  };
};

type ConfirmModalState = {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: (() => Promise<void> | void) | null;
};

type RenameModalState = {
  open: boolean;
  title: string;
  initialValue: string;
  label?: string;
  placeholder?: string;
  confirmText?: string;
  onConfirm: ((value: string) => Promise<void> | void) | null;
};

function formatDate(value: string) {
  if (!value) return "—";

  const normalized = value.replace(" ", "T");
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) return value;

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

function getStatusLabel(status: string) {
  if (status === "processed") return "Обработан";
  if (status === "unassigned") return "Не привязан";
  return status;
}

function getScopeLabel(doc: SearchDoc) {
  if (doc.is_shared || doc.document_scope === "shared") return "Общий";
  return "Личный";
}

function normalizeTextForView(value?: string | null) {
  if (!value) return "—";
  return value.replace(/\s+/g, " ").trim() || "—";
}

export default function SearchPage() {
  const [mode, setMode] = useState<"students" | "analytics">("students");

  const [groups, setGroups] = useState<Group[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [groupId, setGroupId] = useState<number | "">("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [analyticsQuery, setAnalyticsQuery] = useState("");
  const [analyticsDepartmentId, setAnalyticsDepartmentId] = useState<number | "">("");
  const [analyticsGroupId, setAnalyticsGroupId] = useState<number | "">("");
  const [analyticsResult, setAnalyticsResult] = useState<AnalyticsResult | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [showAnalyticsList, setShowAnalyticsList] = useState(false);

  const [profiles, setProfiles] = useState<Record<string, StudentProfileResponse>>({});
  const [profileLoading, setProfileLoading] = useState<Record<string, boolean>>({});
  const [profileError, setProfileError] = useState<Record<string, string>>({});
  const [profileOpened, setProfileOpened] = useState<Record<string, boolean>>({});

  const [confirmLoading, setConfirmLoading] = useState(false);
  const [renameLoading, setRenameLoading] = useState(false);

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    open: false,
    title: "",
    description: "",
    confirmText: "Подтвердить",
    danger: false,
    onConfirm: null,
  });

  const [renameModal, setRenameModal] = useState<RenameModalState>({
    open: false,
    title: "",
    initialValue: "",
    label: "Новое название",
    placeholder: "Введите название",
    confirmText: "Сохранить",
    onConfirm: null,
  });
  const analyticsGroups = useMemo(() => {
    if (!analyticsDepartmentId) return groups;
    return groups.filter((g) => g.department_id === analyticsDepartmentId);
  }, [groups, analyticsDepartmentId]);


  async function loadFilters() {
    const [gRes, dRes] = await Promise.all([
      api.get("/groups/"),
      api.get("/departments/"),
    ]);

    const loadedGroups = Array.isArray(gRes.data) ? gRes.data : [];
    const loadedDepartments = Array.isArray(dRes.data) ? dRes.data : [];

    setGroups(loadedGroups);
    setDepartments(loadedDepartments);

    if (!groupId && loadedGroups.length > 0) {
      setGroupId(loadedGroups[0].id);
    }
  }

  useEffect(() => {
    loadFilters().catch(() => {});
  }, []);

  function switchMode(nextMode: "students" | "analytics") {
    setMode(nextMode);
    setError(null);
  }

  function changeAnalyticsDepartment(value: string) {
    const nextDepartmentId = value === "" ? "" : Number(value);
    setAnalyticsDepartmentId(nextDepartmentId);
    setAnalyticsGroupId("");
  }

  function openConfirmModal(params: {
    title: string;
    description: string;
    confirmText?: string;
    danger?: boolean;
    onConfirm: () => Promise<void> | void;
  }) {
    setConfirmModal({
      open: true,
      title: params.title,
      description: params.description,
      confirmText: params.confirmText || "Подтвердить",
      danger: params.danger || false,
      onConfirm: params.onConfirm,
    });
  }

  function closeConfirmModal() {
    if (confirmLoading) return;

    setConfirmModal({
      open: false,
      title: "",
      description: "",
      confirmText: "Подтвердить",
      danger: false,
      onConfirm: null,
    });
  }

  async function handleModalConfirm() {
    if (!confirmModal.onConfirm) return;

    try {
      setConfirmLoading(true);
      await confirmModal.onConfirm();
      closeConfirmModal();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка выполнения действия");
    } finally {
      setConfirmLoading(false);
    }
  }

  function openRenameModal(params: {
    title: string;
    initialValue?: string;
    label?: string;
    placeholder?: string;
    confirmText?: string;
    onConfirm: (value: string) => Promise<void> | void;
  }) {
    setRenameModal({
      open: true,
      title: params.title,
      initialValue: params.initialValue || "",
      label: params.label || "Новое название",
      placeholder: params.placeholder || "Введите название",
      confirmText: params.confirmText || "Сохранить",
      onConfirm: params.onConfirm,
    });
  }

  function closeRenameModal() {
    if (renameLoading) return;

    setRenameModal({
      open: false,
      title: "",
      initialValue: "",
      label: "Новое название",
      placeholder: "Введите название",
      confirmText: "Сохранить",
      onConfirm: null,
    });
  }

  async function handleRenameConfirm(value: string) {
    if (!renameModal.onConfirm) return;

    try {
      setRenameLoading(true);
      await renameModal.onConfirm(value);
      closeRenameModal();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка сохранения");
    } finally {
      setRenameLoading(false);
    }
  }

  async function doSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();

    setError(null);
    setResult(null);
    setProfiles({});
    setProfileLoading({});
    setProfileError({});
    setProfileOpened({});
    setLoading(true);

    try {
      if (!groupId) {
        setError("Выберите группу");
        return;
      }

      const params: Record<string, string | number> = { group_id: groupId };
      if (q.trim()) {
        params.q = q.trim();
      }

      const res = await api.get("/search/student", { params });
      setResult(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка поиска");
    } finally {
      setLoading(false);
    }
  }

  async function doAnalyticsSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();

    const query = analyticsQuery.trim();

    setError(null);
    setAnalyticsResult(null);
    setShowAnalyticsList(false);

    if (!query) {
      setError("Введите поисковый запрос");
      return;
    }

    setAnalyticsLoading(true);

    try {
      const params: Record<string, string | number> = { q: query };

      if (analyticsDepartmentId !== "") {
        params.department_id = analyticsDepartmentId;
      }

      if (analyticsGroupId !== "") {
        params.group_id = analyticsGroupId;
      }

      const res = await api.get("/search/analytics", { params });

      setAnalyticsResult(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка аналитического поиска");
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function openDocument(doc: SearchDoc) {
    try {
      const response = await api.get(doc.download_url, {
        responseType: "blob",
      });

      const blob = new Blob([response.data], {
        type: response.headers["content-type"] || "application/octet-stream",
      });

      const url = window.URL.createObjectURL(blob);
      const ext = doc.filename.split(".").pop()?.toLowerCase();

      if (ext === "pdf") {
        window.open(url, "_blank");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }

      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 5000);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Не удалось открыть документ";
      setError(msg);
    }
  }

  function renameDocument(doc: SearchDoc) {
    openRenameModal({
      title: "Переименование документа",
      initialValue: doc.display_name || "",
      label: "Название документа",
      placeholder: "Введите название для отображения",
      confirmText: "Сохранить",
      onConfirm: async (value: string) => {
        await api.patch(`/documents/${doc.doc_id}/title`, {
          display_name: value,
        });
        await doSearch();
      },
    });
  }

  function deleteDocument(doc: SearchDoc) {
    const isShared = doc.is_shared || doc.document_scope === "shared";

    const message = isShared
      ? `Это общий документ. Он привязан к ${doc.linked_students_count || 0} студентам.\n\nЕсли удалить его, он исчезнет у всех студентов, к которым привязан.\n\nУдалить документ полностью?`
      : "Это личный документ. Удалить документ?";

    openConfirmModal({
      title: "Удаление документа",
      description: message,
      confirmText: "Удалить",
      danger: true,
      onConfirm: async () => {
        await api.delete(`/documents/${doc.doc_id}`);
        await doSearch();
      },
    });
  }

  function unlinkDocument(doc: SearchDoc, studentId: number) {
    openConfirmModal({
      title: "Отвязка документа",
      description:
        "Отвязать документ от этого студента?\n\nДокумент останется у остальных студентов, к которым он привязан.",
      confirmText: "Отвязать",
      danger: true,
      onConfirm: async () => {
        await api.delete(`/documents/${doc.doc_id}/unlink/${studentId}`);
        await doSearch();
      },
    });
  }

  async function loadStudentProfile(docId: number, studentId: number) {
    const key = `${docId}_${studentId}`;

    if (profileOpened[key] && profiles[key]) {
      setProfileOpened((prev) => ({ ...prev, [key]: false }));
      return;
    }

    if (profiles[key]) {
      setProfileOpened((prev) => ({ ...prev, [key]: true }));
      return;
    }

    setProfileLoading((prev) => ({ ...prev, [key]: true }));
    setProfileError((prev) => ({ ...prev, [key]: "" }));

    try {
      const res = await api.get(`/documents/${docId}/student-profile/${studentId}`);
      setProfiles((prev) => ({ ...prev, [key]: res.data }));
      setProfileOpened((prev) => ({ ...prev, [key]: true }));
    } catch (e: any) {
      setProfileError((prev) => ({
        ...prev,
        [key]: e?.response?.data?.detail || "Не удалось загрузить профиль из DOCX",
      }));
    } finally {
      setProfileLoading((prev) => ({ ...prev, [key]: false }));
    }
  }

  function renderProfileBlock(docId: number, studentId: number) {
    const key = `${docId}_${studentId}`;
    const profileResponse = profiles[key];
    const isOpened = profileOpened[key];
    const isLoading = profileLoading[key];
    const errorText = profileError[key];

    if (isLoading) {
      return (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 16,
            background: "rgba(15, 23, 42, 0.55)",
            border: "1px solid rgba(148, 163, 184, 0.12)",
            color: "var(--text)",
          }}
        >
          Загружаем данные из DOCX...
        </div>
      );
    }

    if (errorText) {
      return (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 16,
            background: "rgba(127, 29, 29, 0.18)",
            border: "1px solid rgba(239, 68, 68, 0.25)",
            color: "#fecaca",
          }}
        >
          {errorText}
        </div>
      );
    }

    if (!isOpened || !profileResponse) return null;

    const profile = profileResponse.profile;

    if (!profile?.found) {
      return (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 16,
            background: "rgba(15, 23, 42, 0.55)",
            border: "1px solid rgba(148, 163, 184, 0.12)",
            color: "var(--text)",
          }}
        >
          Строка студента в DOCX не найдена
          {profile?.reason ? `: ${profile.reason}` : ""}
        </div>
      );
    }

    const rowData = profile.row_data || {};
    const entries = Object.entries(rowData);

    return (
      <div
        className="card"
        style={{
          marginTop: 14,
          padding: 16,
          borderRadius: 18,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#c7d2fe" }}>
          Карточка студента из DOCX
        </div>

        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          Таблица: {profile.table_index}, строка: {profile.row_index}, тип совпадения:{" "}
          {profile.match_type || "unknown"}
        </div>

        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
          }}
        >
          {entries.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>Нет данных для отображения</div>
          ) : (
            entries.map(([key, value]) => (
              <div
                key={key}
                style={{
                  borderRadius: 16,
                  padding: 14,
                  background: "rgba(148, 163, 184, 0.06)",
                  border: "1px solid rgba(148, 163, 184, 0.08)",
                }}
              >
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{key}</div>
                <div
                  style={{
                    marginTop: 6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 14,
                    color: "var(--text)",
                  }}
                >
                  {value || "—"}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  function renderStudentSearch() {
    return (
      <>
        <form onSubmit={doSearch} className="card section-card">
          <div className="grid-3">
            <div>
              <label className="label">Группа</label>
              <select
                className="select"
                value={groupId}
                onChange={(e) =>
                  setGroupId(e.target.value === "" ? "" : Number(e.target.value))
                }
              >
                <option value="">Выберите группу</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.display_name || g.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Фильтр по ФИО</label>
              <input
                className="input"
                placeholder="Фамилия или ФИО"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", alignItems: "end" }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Ищем..." : "Найти"}
              </button>
            </div>
          </div>
        </form>

        {loading ? (
          <div className="card section-card">Загрузка...</div>
        ) : result ? (
          <div className="stack">
            <div className="card section-card">
              <div className="info-list">
                <div className="info-item">
                  <span className="info-item-label">Группа</span>
                  <span className="info-item-value">{result.group_display_name || result.group}</span>
                </div>
                <div className="info-item">
                  <span className="info-item-label">Найдено студентов</span>
                  <span className="info-item-value">{result.students.length}</span>
                </div>
              </div>
            </div>

            {result.students.length === 0 ? (
              <EmptyState
                title="Студенты не найдены"
                description="Попробуй изменить группу или уточнить ФИО в фильтре."
                icon={<span>🔎</span>}
              />
            ) : (
              result.students.map((s) => (
                <div key={s.id} className="card section-card">
                  <div className="page-header" style={{ marginBottom: 16 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>{s.full_name}</h3>
                      <p className="page-subtitle" style={{ marginTop: 6 }}>
                        Группа: {s.group_name || result.group_display_name || result.group} • Курс: {s.course || "—"} • Email: {s.email || "—"}
                      </p>
                    </div>
                  </div>

                  <div className="stack">
                    {s.documents.length === 0 ? (
                      <EmptyState
                        title="У студента нет документов"
                        description="Для этого студента пока не найдено прикреплённых файлов."
                        icon={<span>📄</span>}
                      />
                    ) : (
                      s.documents.map((d) => (
                        <div key={d.doc_id} className="card section-card">
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              justifyContent: "space-between",
                              gap: 14,
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 260 }}>
                              <div style={{ fontWeight: 700, fontSize: 16 }}>
                                {d.effective_name || d.display_name || d.filename}
                              </div>

                              <div className="row" style={{ marginTop: 10 }}>
                                <StatusBadge status={d.status} text={getStatusLabel(d.status)} />
                                <StatusBadge
                                  status={getScopeLabel(d) === "Общий" ? "shared" : "personal"}
                                  text={getScopeLabel(d)}
                                />
                                <StatusBadge status={d.file_type} text={d.file_type} />
                              </div>

                              <div
                                style={{
                                  marginTop: 8,
                                  fontSize: 12,
                                  color: "var(--muted)",
                                }}
                              >
                                Загружен: {formatDate(d.uploaded_at)}
                              </div>

                              {(d.is_shared || d.document_scope === "shared") && (
                                <div
                                  style={{
                                    marginTop: 6,
                                    fontSize: 12,
                                    color: "#fcd34d",
                                  }}
                                >
                                  Привязан к {d.linked_students_count || 0} студентам
                                </div>
                              )}

                              {d.ai?.doc_type && (
                                <div
                                  style={{
                                    marginTop: 8,
                                    fontSize: 12,
                                    color: "var(--muted)",
                                  }}
                                >
                                  AI тип документа: {d.ai.doc_type}
                                </div>
                              )}
                            </div>

                            <div className="row" style={{ alignSelf: "flex-start" }}>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => openDocument(d)}
                              >
                                Скачать
                              </button>

                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => renameDocument(d)}
                              >
                                Переименовать
                              </button>

                              {(d.is_shared || d.document_scope === "shared") && (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => unlinkDocument(d, s.id)}
                                >
                                  Отвязать
                                </button>
                              )}

                              <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => deleteDocument(d)}
                              >
                                Удалить
                              </button>

                              {d.file_type === "docx" && (
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={() => loadStudentProfile(d.doc_id, s.id)}
                                >
                                  {profileOpened[`${d.doc_id}_${s.id}`]
                                    ? "Скрыть данные из DOCX"
                                    : "Показать данные из DOCX"}
                                </button>
                              )}
                            </div>
                          </div>

                          {d.text_preview ? (
                            <div
                              style={{
                                marginTop: 14,
                                padding: 14,
                                borderRadius: 16,
                                background: "rgba(15, 23, 42, 0.45)",
                                border: "1px solid rgba(148, 163, 184, 0.08)",
                                whiteSpace: "pre-wrap",
                                fontSize: 14,
                                color: "var(--text)",
                              }}
                            >
                              {d.text_preview}
                            </div>
                          ) : null}

                          {renderProfileBlock(d.doc_id, s.id)}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <EmptyState
            title="Поиск ещё не выполнен"
            description="Выбери группу и нажми «Найти», чтобы увидеть студентов и их документы."
            icon={<span>🔎</span>}
          />
        )}
      </>
    );
  }

  function renderAnalyticsSearch() {
    return (
      <div className="stack">
        <form onSubmit={doAnalyticsSearch} className="card section-card">
          <div className="grid-3">
            <div>
              <label className="label">Запрос по данным документов</label>
              <input
                className="input"
                placeholder="Например: Коянкус, уйгур, общежитие"
                value={analyticsQuery}
                onChange={(e) => setAnalyticsQuery(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Отделение</label>
              <select
                className="select"
                value={analyticsDepartmentId}
                onChange={(e) => changeAnalyticsDepartment(e.target.value)}
              >
                <option value="">Все доступные отделения</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Группа</label>
              <select
                className="select"
                value={analyticsGroupId}
                onChange={(e) =>
                  setAnalyticsGroupId(e.target.value === "" ? "" : Number(e.target.value))
                }
              >
                <option value="">Все доступные группы</option>
                {analyticsGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.display_name || g.name}
                    {g.department_name ? ` • ${g.department_name}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "end" }}>
              <button type="submit" className="btn btn-primary" disabled={analyticsLoading}>
                {analyticsLoading ? "Ищем..." : "Найти"}
              </button>
            </div>
          </div>
        </form>

        {analyticsLoading ? (
          <div className="card section-card">Загрузка...</div>
        ) : analyticsResult ? (
          <div className="stack">
            <div className="card section-card">
              <div className="info-list">
                <div className="info-item">
                  <span className="info-item-label">Запрос</span>
                  <span className="info-item-value">{analyticsResult.query}</span>
                </div>

                <div className="info-item">
                  <span className="info-item-label">Найдено студентов</span>
                  <span className="info-item-value">{analyticsResult.count}</span>
                </div>

                <div className="info-item">
                  <span className="info-item-label">Фильтр</span>
                  <span className="info-item-value">
                    {analyticsGroupId
                      ? `Группа: ${groups.find((g) => g.id === analyticsGroupId)?.display_name || analyticsGroupId}`
                      : analyticsDepartmentId
                      ? `Отделение: ${departments.find((d) => d.id === analyticsDepartmentId)?.name || analyticsDepartmentId}`
                      : "Все доступные данные"}
                  </span>
                </div>
              </div>

              {analyticsResult.count > 0 ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: 16 }}
                  onClick={() => setShowAnalyticsList((prev) => !prev)}
                >
                  {showAnalyticsList ? "Скрыть список студентов" : "Показать список студентов"}
                </button>
              ) : null}
            </div>

            {analyticsResult.count === 0 ? (
              <EmptyState
                title="Совпадений не найдено"
                description="Попробуй изменить формулировку запроса."
                icon={<span>🔎</span>}
              />
            ) : null}

            {showAnalyticsList ? (
              <div className="stack">
                {analyticsResult.students.map((student) => (
                  <div key={student.student_id} className="card section-card">
                    <div className="page-header" style={{ marginBottom: 16 }}>
                      <div>
                        <h3 style={{ margin: 0 }}>{student.full_name}</h3>
                        <p className="page-subtitle" style={{ marginTop: 6 }}>
                          Группа: {student.group_name || "—"} • Отделение: {student.department_name || "—"}
                        </p>
                      </div>
                    </div>

                    <div className="stack">
                      {student.documents.map((doc) => (
                        <div key={doc.doc_id} className="card section-card">
                          <div style={{ fontWeight: 700, fontSize: 16 }}>
                            {doc.display_name || doc.filename}
                          </div>

                          <div
                            className="page-subtitle"
                            style={{
                              marginTop: 6,
                              fontSize: 12,
                              wordBreak: "break-all",
                            }}
                          >
                            {doc.filename}
                          </div>

                          <div
                            style={{
                              marginTop: 14,
                              padding: 14,
                              borderRadius: 16,
                              background: "rgba(15, 23, 42, 0.45)",
                              border: "1px solid rgba(148, 163, 184, 0.08)",
                              whiteSpace: "pre-wrap",
                              fontSize: 14,
                              color: "var(--text)",
                            }}
                          >
                            {normalizeTextForView(doc.matched_fragment)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState
            title="Аналитический поиск ещё не выполнен"
            description="Введите запрос и нажмите «Найти». Сначала система покажет количество найденных студентов."
            icon={<span>📊</span>}
          />
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Поиск"
        subtitle="Обычный поиск студентов и аналитический поиск по данным документов на одной странице."
      />

      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className={mode === "students" ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => switchMode("students")}
        >
          По студентам
        </button>

        <button
          type="button"
          className={mode === "analytics" ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => switchMode("analytics")}
        >
          Аналитический поиск
        </button>
      </div>

      {error ? (
        <div
          className="card section-card"
          style={{
            borderColor: "rgba(239, 68, 68, 0.25)",
            background: "rgba(127, 29, 29, 0.18)",
            color: "#fecaca",
          }}
        >
          {error}
        </div>
      ) : null}

      {mode === "students" ? renderStudentSearch() : renderAnalyticsSearch()}

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        description={confirmModal.description}
        confirmText={confirmModal.confirmText}
        danger={confirmModal.danger}
        loading={confirmLoading}
        onConfirm={handleModalConfirm}
        onClose={closeConfirmModal}
      />

      <RenameModal
        open={renameModal.open}
        title={renameModal.title}
        label={renameModal.label}
        placeholder={renameModal.placeholder}
        initialValue={renameModal.initialValue}
        confirmText={renameModal.confirmText}
        loading={renameLoading}
        onConfirm={handleRenameConfirm}
        onClose={closeRenameModal}
      />
    </div>
  );
}
