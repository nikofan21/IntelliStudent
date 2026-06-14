import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import PageHeader from "../components/ui/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import StatusBadge from "../components/ui/StatusBadge";
import ConfirmModal from "../components/ui/ConfirmModal";
import RenameModal from "../components/ui/RenameModal";

type Group = { id: number; name: string };

type Student = {
  id: number;
  full_name: string;
  group_id: number;
};

type Me = {
  id: number;
  login: string;
  role: string;
};

type UnassignedDoc = {
  id: number;
  filename: string;
  display_name?: string | null;
  file_type: string;
  status: string;
  uploaded_at: string;
  text_preview: string;
  entities_json?: string | null;
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
  const d = new Date(value.replace(" ", "T"));
  if (isNaN(d.getTime())) return value;

  return `${d.toLocaleDateString()} ${d.toLocaleTimeString().slice(0, 5)}`;
}

function parseEntities(value?: string | null): Record<string, any> | null {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export default function UnassignedDocuments() {
  const [me, setMe] = useState<Me | null>(null);
  const [docs, setDocs] = useState<UnassignedDoc[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedGroup, setSelectedGroup] = useState<Record<number, string>>({});
  const [selectedStudent, setSelectedStudent] = useState<Record<number, string>>({});

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "">("");

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

  const selectStyle: React.CSSProperties = {
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    backgroundImage: "none",
    paddingRight: "14px",
  };

  function showError(text: string) {
    setMessageType("error");
    setMessage(text);
  }

  function showSuccess(text: string) {
    setMessageType("success");
    setMessage(text);
  }

  function clearMessage() {
    setMessage("");
    setMessageType("");
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
      showError(e?.response?.data?.detail || "Ошибка выполнения действия");
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
      showError(e?.response?.data?.detail || "Ошибка сохранения");
    } finally {
      setRenameLoading(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    clearMessage();

    try {
      const [meRes, docsRes, gRes, sRes] = await Promise.all([
        api.get("/auth/me"),
        api.get("/documents/unassigned"),
        api.get("/groups/"),
        api.get("/students/"),
      ]);

      setMe(meRes.data);
      setDocs(Array.isArray(docsRes.data) ? docsRes.data : []);
      setGroups(Array.isArray(gRes.data) ? gRes.data : []);
      setStudents(Array.isArray(sRes.data) ? sRes.data : []);
    } catch (e: any) {
      showError(e?.response?.data?.detail || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function getStudentsByGroup(groupId: number) {
    return students.filter((s) => s.group_id === groupId);
  }

  function getSuggestedGroupId(doc: UnassignedDoc): number | null {
    const entities = parseEntities(doc.entities_json);
    const groupName = entities?.group_name;

    if (!groupName) return null;

    const matchedGroup = groups.find((g) => g.name === groupName);
    return matchedGroup ? matchedGroup.id : null;
  }

  async function assignToStudent(docId: number) {
    clearMessage();

    const studentId = selectedStudent[docId];
    if (!studentId) {
      showError("Выберите студента");
      return;
    }

    try {
      await api.post(`/documents/${docId}/assign?student_id=${studentId}`);
      showSuccess("Документ привязан к студенту");
      await loadAll();
    } catch (e: any) {
      showError(e?.response?.data?.detail || "Ошибка привязки к студенту");
    }
  }

  async function assignToGroup(docId: number) {
    clearMessage();

    const groupId = selectedGroup[docId];
    if (!groupId) {
      showError("Выберите группу");
      return;
    }

    try {
      await api.post(`/documents/${docId}/assign-group/${groupId}`);
      showSuccess("Документ привязан к группе");
      await loadAll();
    } catch (e: any) {
      showError(e?.response?.data?.detail || "Ошибка привязки к группе");
    }
  }

  async function renameDocument(doc: UnassignedDoc) {
    openRenameModal({
      title: "Переименование документа",
      initialValue: doc.display_name || "",
      label: "Название документа",
      placeholder: "Введите название",
      confirmText: "Сохранить",
      onConfirm: async (value: string) => {
        await api.patch(`/documents/${doc.id}/title`, {
          display_name: value,
        });

        showSuccess("Название документа обновлено");
        await loadAll();
      },
    });
  }

  async function deleteDocument(docId: number) {
    openConfirmModal({
      title: "Удаление документа",
      description: "Удалить документ?",
      confirmText: "Удалить",
      danger: true,
      onConfirm: async () => {
        await api.delete(`/documents/${docId}`);
        showSuccess("Документ удалён");
        await loadAll();
      },
    });
  }

  const isTeacher = me?.role === "teacher";
  const canDelete = me?.role === "admin";
  const canRename = me?.role === "admin" || me?.role === "teacher";

  const subtitle = isTeacher
    ? "Непривязанные документы только ваших групп. Здесь можно вручную привязать их без участия администратора."
    : "AI не смог определить студента — требуется ручная привязка";

  const docsWithSuggestions = useMemo(() => {
    return docs.map((doc) => ({
      ...doc,
      suggestedGroupId: getSuggestedGroupId(doc),
    }));
  }, [docs, groups]);

  if (loading) {
    return <div className="card section-card">Загрузка...</div>;
  }

  return (
    <div className="stack">
      <PageHeader
        title="Непривязанные документы"
        subtitle={subtitle}
        action={
          <button className="btn btn-secondary" onClick={loadAll}>
            Обновить
          </button>
        }
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

      {docs.length === 0 ? (
        <EmptyState
          title="Непривязанных документов нет"
          description={
            isTeacher
              ? "По вашим группам сейчас нет документов, требующих ручной привязки."
              : "Отлично! Нет непривязанных документов."
          }
          icon={<span>✅</span>}
        />
      ) : (
        docsWithSuggestions.map((doc) => {
          const groupId =
            Number(selectedGroup[doc.id] || 0) || Number(doc.suggestedGroupId || 0);

          const filteredStudents = groupId ? getStudentsByGroup(groupId) : [];
          const entities = parseEntities(doc.entities_json);
          const aiGroupName = entities?.group_name || null;
          const aiFio = entities?.fio || null;

          return (
            <div key={doc.id} className="card section-card">
              <div className="row" style={{ justifyContent: "space-between", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 18 }}>
                    {doc.display_name || doc.filename}
                  </div>

                  <div className="row" style={{ marginTop: 8 }}>
                    <StatusBadge status={doc.status} />
                    <StatusBadge status={doc.file_type} />
                    {isTeacher && <StatusBadge status="processed" text="Моя зона" />}
                  </div>

                  <div className="page-subtitle" style={{ marginTop: 8 }}>
                    {formatDate(doc.uploaded_at)}
                  </div>
                </div>

                <div className="row" style={{ alignItems: "flex-start" }}>
                  {canRename && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => renameDocument(doc)}
                    >
                      Переименовать
                    </button>
                  )}

                  {canDelete && (
                    <button
                      className="btn btn-danger"
                      onClick={() => deleteDocument(doc.id)}
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </div>

              {doc.text_preview && (
                <div className="card" style={{ padding: 12, marginTop: 12 }}>
                  {doc.text_preview}
                </div>
              )}

              {(aiGroupName || aiFio) && (
                <div
                  className="card"
                  style={{
                    padding: 12,
                    marginTop: 12,
                    background: "rgba(59, 130, 246, 0.08)",
                    border: "1px solid rgba(59, 130, 246, 0.18)",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Подсказка AI</div>

                  {aiGroupName && (
                    <div className="page-subtitle" style={{ marginTop: 4 }}>
                      Группа: {aiGroupName}
                    </div>
                  )}

                  {aiFio && (
                    <div className="page-subtitle" style={{ marginTop: 4 }}>
                      ФИО: {aiFio}
                    </div>
                  )}
                </div>
              )}

              <div className="grid-2" style={{ marginTop: 16 }}>
                <div className="card section-card">
                  <div style={{ fontWeight: 600, marginBottom: 10 }}>
                    Привязать к группе
                  </div>

                  <select
                    className="select"
                    style={selectStyle}
                    value={selectedGroup[doc.id] || String(doc.suggestedGroupId || "")}
                    onChange={(e) =>
                      setSelectedGroup((p) => ({
                        ...p,
                        [doc.id]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Выберите группу</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>

                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 12 }}
                    onClick={() => assignToGroup(doc.id)}
                  >
                    Привязать
                  </button>
                </div>

                <div className="card section-card">
                  <div style={{ fontWeight: 600, marginBottom: 10 }}>
                    Привязать к студенту
                  </div>

                  <select
                    className="select"
                    style={selectStyle}
                    value={selectedGroup[doc.id] || String(doc.suggestedGroupId || "")}
                    onChange={(e) =>
                      setSelectedGroup((p) => ({
                        ...p,
                        [doc.id]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Сначала выберите группу</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>

                  <select
                    className="select"
                    style={{ ...selectStyle, marginTop: 10 }}
                    value={selectedStudent[doc.id] || ""}
                    onChange={(e) =>
                      setSelectedStudent((p) => ({
                        ...p,
                        [doc.id]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Выберите студента</option>
                    {filteredStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </select>

                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 12 }}
                    onClick={() => assignToStudent(doc.id)}
                  >
                    Привязать
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}

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