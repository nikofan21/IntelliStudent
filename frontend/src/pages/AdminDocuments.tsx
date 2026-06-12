import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../lib/api";
import ConfirmModal from "../components/ui/ConfirmModal";
import RenameModal from "../components/ui/RenameModal";

type StudentLink = {
  id: number;
  full_name: string;
  match_source: string;
};

type Doc = {
  id: number;
  filename: string;
  display_name?: string | null;
  file_type: string;
  status: string;
  uploaded_at: string;
  linked_students_count: number;
  is_shared: boolean;
  students: StudentLink[];
};

type MeResponse = {
  id: number;
  login?: string;
  username?: string;
  role: string;
};

type GroupItem = {
  id: number;
  name: string;
  department_id?: number | null;
  department_name?: string | null;
};

type DepartmentItem = {
  id: number;
  name: string;
  description?: string | null;
  is_active?: boolean;
  created_at?: string | null;
};

type UserRole = "teacher" | "head" | "manager" | "admin";

type UserItem = {
  id: number;
  login: string;
  role: string;
  group_ids?: number[];
  groups?: GroupItem[];
  department_ids?: number[];
  departments?: DepartmentItem[];
  created_at?: string | null;
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

function getFileTypeBadge(fileType: string) {
  const value = fileType.toLowerCase();
  if (value === "pdf") return "badge badge-danger";
  if (value === "docx") return "badge badge-info";
  if (value === "txt") return "badge badge-gray";
  return "badge badge-default";
}

function getStatusBadge(status: string) {
  if (status === "processed") return "badge badge-success";
  if (status === "unassigned") return "badge badge-warning";
  return "badge badge-default";
}

function getStatusLabel(status: string) {
  if (status === "processed") return "Обработан";
  if (status === "unassigned") return "Не привязан";
  return status;
}

function getScopeBadge(isShared: boolean) {
  return isShared ? "badge badge-purple" : "badge badge-primary";
}

function getMatchSourceLabel(source: string) {
  if (source === "ai") return "AI";
  if (source === "ai_group") return "AI группа";
  if (source === "group_assign") return "Группа";
  if (source === "manual") return "Вручную";
  if (source === "manual_many") return "Вручную список";
  return source;
}

export default function AdminDocuments() {
  const [tab, setTab] = useState<"docs" | "users" | "departments">("docs");

  const [docs, setDocs] = useState<Doc[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);

  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "shared" | "personal">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "pdf" | "docx" | "txt">("all");

  const [newLogin, setNewLogin] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newRole, setNewRole] = useState<UserRole>("teacher");
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<number[]>([]);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [newDepartmentDesc, setNewDepartmentDesc] = useState("");
  const [creatingDepartment, setCreatingDepartment] = useState(false);

  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editLogin, setEditLogin] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("teacher");
  const [editPassword, setEditPassword] = useState("");
  const [editPasswordConfirm, setEditPasswordConfirm] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editGroups, setEditGroups] = useState<number[]>([]);
  const [editDepartments, setEditDepartments] = useState<number[]>([]);

  const [openDocId, setOpenDocId] = useState<number | null>(null);

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

  async function loadMe() {
    try {
      const res = await api.get("/auth/me");
      setMe(res.data);
    } catch {
      setMe(null);
    } finally {
      setMeLoaded(true);
    }
  }

  async function loadDocs() {
    setLoading(true);
    try {
      const res = await api.get("/documents/admin/all");
      setDocs(res.data);
    } catch (e: any) {
      showError(e?.response?.data?.detail || "Ошибка загрузки документов");
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    setUsersLoading(true);
    try {
      const res = await api.get("/auth/users");
      setUsers(res.data);
    } catch (e: any) {
      showError(e?.response?.data?.detail || "Ошибка загрузки пользователей");
    } finally {
      setUsersLoading(false);
    }
  }

  async function loadGroups() {
    try {
      const res = await api.get("/groups");
      setGroups(res.data);
    } catch (e: any) {
      showError(e?.response?.data?.detail || "Ошибка загрузки групп");
    }
  }

  async function loadDepartments() {
    try {
      const res = await api.get("/departments");
      setDepartments(res.data);
    } catch (e: any) {
      showError(e?.response?.data?.detail || "Ошибка загрузки отделений");
    }
  }

  useEffect(() => {
    loadMe();
  }, []);

  useEffect(() => {
    if (meLoaded && (me?.role === "admin" || me?.role === "manager")) {
      loadDocs();
      loadUsers();
      loadGroups();
      loadDepartments();
    }
  }, [meLoaded, me]);

  async function deleteDoc(id: number, isShared: boolean, count: number) {
    const confirmText = isShared
      ? `Удалить общий документ?\n\nОн исчезнет у ${count} студентов.`
      : "Удалить документ?";

    openConfirmModal({
      title: "Удаление документа",
      description: confirmText,
      confirmText: "Удалить",
      danger: true,
      onConfirm: async () => {
        await api.delete(`/documents/${id}`);
        if (openDocId === id) {
          setOpenDocId(null);
        }
        await loadDocs();
        showSuccess("Документ удалён");
      },
    });
  }

  async function unlink(docId: number, studentId: number) {
    openConfirmModal({
      title: "Отвязка документа",
      description: "Отвязать документ от студента?",
      confirmText: "Отвязать",
      danger: true,
      onConfirm: async () => {
        await api.delete(`/documents/${docId}/unlink/${studentId}`);
        await loadDocs();
        showSuccess("Документ отвязан от студента");
      },
    });
  }

  async function rename(doc: Doc) {
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
        await loadDocs();
        showSuccess("Название документа обновлено");
      },
    });
  }

  async function createUser() {
    clearMessage();

    if (!newLogin.trim() || !newPassword.trim() || !newPasswordConfirm.trim()) {
      showError("Заполни логин, пароль и подтверждение пароля");
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      showError("Пароли не совпадают");
      return;
    }

    if (me?.role === "manager" && newRole === "admin") {
      showError("Руководство не может создавать администратора");
      return;
    }

    if (newRole === "teacher" && selectedGroups.length === 0) {
      showError("Для teacher нужно выбрать хотя бы одну группу");
      return;
    }

    if (newRole === "head" && selectedDepartments.length === 0) {
      showError("Для head нужно выбрать хотя бы одно отделение");
      return;
    }

    try {
      setCreatingUser(true);

      await api.post("/auth/register", {
        login: newLogin.trim(),
        password: newPassword,
        role: newRole,
        group_ids: newRole === "teacher" ? selectedGroups : [],
        department_ids: newRole === "head" ? selectedDepartments : [],
      });

      setNewLogin("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setNewRole("teacher");
      setSelectedGroups([]);
      setSelectedDepartments([]);

      await loadUsers();
      showSuccess("Пользователь создан");
    } catch (e: any) {
      showError(e?.response?.data?.detail || "Ошибка создания пользователя");
    } finally {
      setCreatingUser(false);
    }
  }

  async function deleteUser(userId: number, login: string) {
    if (me?.role !== "admin") {
      showError("Удалять пользователей может только администратор");
      return;
    }

    openConfirmModal({
      title: "Удаление пользователя",
      description: `Удалить пользователя ${login}?`,
      confirmText: "Удалить",
      danger: true,
      onConfirm: async () => {
        await api.delete(`/auth/users/${userId}`);
        if (editingUserId === userId) {
          cancelEdit();
        }
        await loadUsers();
        showSuccess("Пользователь удалён");
      },
    });
  }

  function startEdit(user: UserItem) {
    clearMessage();
    setEditingUserId(user.id);
    setEditLogin(user.login);
    setEditRole(user.role as UserRole);
    setEditPassword("");

    if (user.group_ids && user.group_ids.length > 0) {
      setEditGroups(user.group_ids);
    } else if (user.groups && user.groups.length > 0) {
      setEditGroups(user.groups.map((g) => g.id));
    } else {
      setEditGroups([]);
    }

    if (user.department_ids && user.department_ids.length > 0) {
      setEditDepartments(user.department_ids);
    } else if (user.departments && user.departments.length > 0) {
      setEditDepartments(user.departments.map((d) => d.id));
    } else {
      setEditDepartments([]);
    }
  }

  function cancelEdit() {
    setEditingUserId(null);
    setEditLogin("");
    setEditRole("teacher");
    setEditPassword("");
    setEditPasswordConfirm("");
    setEditGroups([]);
    setEditDepartments([]);
  }

  function toggleNewGroup(groupId: number, checked: boolean) {
    if (checked) {
      setSelectedGroups((prev) => (prev.includes(groupId) ? prev : [...prev, groupId]));
    } else {
      setSelectedGroups((prev) => prev.filter((id) => id !== groupId));
    }
  }

  function toggleEditGroup(groupId: number, checked: boolean) {
    if (checked) {
      setEditGroups((prev) => (prev.includes(groupId) ? prev : [...prev, groupId]));
    } else {
      setEditGroups((prev) => prev.filter((id) => id !== groupId));
    }
  }

  function toggleNewDepartment(departmentId: number, checked: boolean) {
    if (checked) {
      setSelectedDepartments((prev) =>
        prev.includes(departmentId) ? prev : [...prev, departmentId]
      );
    } else {
      setSelectedDepartments((prev) => prev.filter((id) => id !== departmentId));
    }
  }

  function toggleEditDepartment(departmentId: number, checked: boolean) {
    if (checked) {
      setEditDepartments((prev) =>
        prev.includes(departmentId) ? prev : [...prev, departmentId]
      );
    } else {
      setEditDepartments((prev) => prev.filter((id) => id !== departmentId));
    }
  }

  async function saveUser(userId: number) {
    clearMessage();

    if (!editLogin.trim()) {
      showError("Логин не может быть пустым");
      return;
    }

    if (me?.role === "manager" && editRole === "admin") {
      showError("Руководство не может назначать роль администратора");
      return;
    }

    if (me?.role === "manager" && editPassword.trim()) {
      showError("Руководство не может менять пароли пользователей");
      return;
    }

    if (editPassword.trim() || editPasswordConfirm.trim()) {
      if (editPassword !== editPasswordConfirm) {
        showError("Пароли не совпадают");
        return;
      }
    }

    if (editRole === "teacher" && editGroups.length === 0) {
      showError("Для teacher нужно выбрать хотя бы одну группу");
      return;
    }

    if (editRole === "head" && editDepartments.length === 0) {
      showError("Для head нужно выбрать хотя бы одно отделение");
      return;
    }

    const doSave = async () => {
      try {
        setSavingUserId(userId);

        await api.put(`/auth/users/${userId}`, {
          login: editLogin.trim(),
          role: editRole,
          password: editPassword.trim() ? editPassword : undefined,
          group_ids: editRole === "teacher" ? editGroups : [],
          department_ids: editRole === "head" ? editDepartments : [],
        });

        cancelEdit();
        await loadUsers();
        showSuccess("Пользователь обновлён");
      } catch (e: any) {
        showError(e?.response?.data?.detail || "Ошибка обновления пользователя");
      } finally {
        setSavingUserId(null);
      }
    };

    if (editPassword.trim()) {
      openConfirmModal({
        title: "Смена пароля",
        description: `Вы действительно хотите изменить пароль пользователя ${editLogin.trim()}?`,
        confirmText: "Да, изменить",
        danger: true,
        onConfirm: doSave,
      });
      return;
    }

    await doSave();
  }

  async function createDepartment() {
    clearMessage();

    if (!newDepartmentName.trim()) {
      showError("Введите название отделения");
      return;
    }

    try {
      setCreatingDepartment(true);

      await api.post("/departments", {
        name: newDepartmentName.trim(),
        description: newDepartmentDesc.trim() || null,
      });

      setNewDepartmentName("");
      setNewDepartmentDesc("");

      await loadDepartments();
      showSuccess("Отделение создано");
    } catch (e: any) {
      showError(e?.response?.data?.detail || "Ошибка создания отделения");
    } finally {
      setCreatingDepartment(false);
    }
  }

  async function deleteDepartment(departmentId: number, name: string) {
    openConfirmModal({
      title: "Удаление отделения",
      description: `Удалить отделение ${name}?`,
      confirmText: "Удалить",
      danger: true,
      onConfirm: async () => {
        await api.delete(`/departments/${departmentId}`);
        await loadDepartments();
        showSuccess("Отделение удалено");
      },
    });
  }

  const filteredDocs = useMemo(() => {
    return docs.filter((d) => {
      const title = (d.display_name || d.filename || "").toLowerCase();
      const originalName = (d.filename || "").toLowerCase();
      const query = search.trim().toLowerCase();

      const searchOk = !query || title.includes(query) || originalName.includes(query);

      const scopeOk =
        scopeFilter === "all" ||
        (scopeFilter === "shared" && d.is_shared) ||
        (scopeFilter === "personal" && !d.is_shared);

      const typeOk = typeFilter === "all" || d.file_type.toLowerCase() === typeFilter;

      return searchOk && scopeOk && typeOk;
    });
  }, [docs, search, scopeFilter, typeFilter]);

  const stats = useMemo(() => {
    const total = docs.length;
    const shared = docs.filter((d) => d.is_shared).length;
    const personal = docs.filter((d) => !d.is_shared).length;
    const processed = docs.filter((d) => d.status === "processed").length;

    return { total, shared, personal, processed };
  }, [docs]);

  if (!meLoaded) return <div className="page-subtitle">Проверка доступа...</div>;

  if (me?.role !== "admin" && me?.role !== "manager") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Админ-панель</h1>
          <p className="page-subtitle">
            Управление документами, пользователями, ролями и привязкой групп
          </p>
        </div>
      </div>

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

      <div className="row" style={{ gap: 10 }}>
        <button
          className={tab === "docs" ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => setTab("docs")}
        >
          Админка
        </button>

        <button
          className={tab === "users" ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => setTab("users")}
        >
          Пользователи
        </button>

        <button
          className={tab === "departments" ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => setTab("departments")}
        >
          Отделения
        </button>
      </div>

      {tab === "docs" && (
        <>
          {loading ? (
            <div className="page-subtitle">Загрузка...</div>
          ) : (
            <>
              <div className="grid-4">
                <div className="card stat-card">
                  <div className="stat-card-top">
                    <div>
                      <div className="stat-card-title">Всего документов</div>
                      <div className="stat-card-value">{stats.total}</div>
                    </div>
                    <div className="stat-card-icon">📄</div>
                  </div>
                  <div className="stat-card-subtitle">Все документы в системе</div>
                </div>

                <div className="card stat-card">
                  <div className="stat-card-top">
                    <div>
                      <div className="stat-card-title">Общие</div>
                      <div className="stat-card-value">{stats.shared}</div>
                    </div>
                    <div className="stat-card-icon">👥</div>
                  </div>
                  <div className="stat-card-subtitle">Привязаны к нескольким студентам</div>
                </div>

                <div className="card stat-card">
                  <div className="stat-card-top">
                    <div>
                      <div className="stat-card-title">Личные</div>
                      <div className="stat-card-value">{stats.personal}</div>
                    </div>
                    <div className="stat-card-icon">👤</div>
                  </div>
                  <div className="stat-card-subtitle">Привязаны к одному студенту</div>
                </div>

                <div className="card stat-card">
                  <div className="stat-card-top">
                    <div>
                      <div className="stat-card-title">Обработанные</div>
                      <div className="stat-card-value">{stats.processed}</div>
                    </div>
                    <div className="stat-card-icon">✅</div>
                  </div>
                  <div className="stat-card-subtitle">Успешно обработанные документы</div>
                </div>
              </div>

              <div className="card section-card">
                <div className="grid-4">
                  <div>
                    <label className="label">Поиск по названию</label>
                    <input
                      className="input"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Введите название или имя файла"
                    />
                  </div>

                  <div>
                    <label className="label">Тип привязки</label>
                    <select
                      className="select"
                      style={selectStyle}
                      value={scopeFilter}
                      onChange={(e) =>
                        setScopeFilter(e.target.value as "all" | "shared" | "personal")
                      }
                    >
                      <option value="all">Все типы привязки</option>
                      <option value="shared">Только общие</option>
                      <option value="personal">Только личные</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Тип файла</label>
                    <select
                      className="select"
                      style={selectStyle}
                      value={typeFilter}
                      onChange={(e) =>
                        setTypeFilter(e.target.value as "all" | "pdf" | "docx" | "txt")
                      }
                    >
                      <option value="all">Все типы файлов</option>
                      <option value="docx">DOCX</option>
                      <option value="pdf">PDF</option>
                      <option value="txt">TXT</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Действие</label>
                    <button className="btn btn-primary" onClick={loadDocs}>
                      Обновить
                    </button>
                  </div>
                </div>
              </div>

              {filteredDocs.length === 0 ? (
                <div className="card empty-state">
                  <div className="empty-state-icon">📭</div>
                  <h3>Документы не найдены</h3>
                  <p>По текущим фильтрам нет ни одного документа.</p>
                </div>
              ) : (
                <div className="grid-3">
                  {filteredDocs.map((d) => {
                    const isOpen = openDocId === d.id;

                    return (
                      <div key={d.id} className="card section-card">
                        <div
                          className="row"
                          style={{
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 12,
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: "16px",
                                fontWeight: 700,
                                lineHeight: "1.3",
                                maxHeight: "2.6em",
                                overflow: "hidden",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                wordBreak: "break-word",
                              }}
                              title={d.display_name || d.filename}
                            >
                              {d.display_name || d.filename}
                            </div>

                            <div
                              className="page-subtitle"
                              style={{
                                marginTop: 4,
                                fontSize: "12px",
                                opacity: 0.75,
                                wordBreak: "break-all",
                              }}
                              title={d.filename}
                            >
                              {d.filename}
                            </div>

                            <div className="page-subtitle" style={{ marginTop: 8 }}>
                              Загружен: {formatDate(d.uploaded_at)}
                            </div>

                            <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                              <span className={getFileTypeBadge(d.file_type)}>
                                {d.file_type.toUpperCase()}
                              </span>

                              <span className={getStatusBadge(d.status)}>
                                {getStatusLabel(d.status)}
                              </span>

                              <span className={getScopeBadge(d.is_shared)}>
                                {d.is_shared ? `Общий (${d.linked_students_count})` : "Личный"}
                              </span>

                              <span className="badge badge-default">
                                Студентов: {d.linked_students_count}
                              </span>
                            </div>
                          </div>

                          <div
                            className="row"
                            style={{
                              flexShrink: 0,
                              alignItems: "flex-start",
                              flexWrap: "wrap",
                              justifyContent: "flex-end",
                            }}
                          >
                            <button
                              className="btn btn-secondary"
                              onClick={() => setOpenDocId(isOpen ? null : d.id)}
                            >
                              {isOpen ? "Свернуть" : "Развернуть"}
                            </button>

                            <button className="btn btn-secondary" onClick={() => rename(d)}>
                              ✏️
                            </button>

                            <button
                              className="btn btn-danger"
                              onClick={() =>
                                deleteDoc(d.id, d.is_shared, d.linked_students_count)
                              }
                            >
                              🗑
                            </button>
                          </div>
                        </div>

                        {isOpen && (
                          <div style={{ marginTop: 18 }}>
                            <div style={{ fontWeight: 600, marginBottom: 10 }}>
                              Привязанные студенты
                            </div>

                            {d.students.length === 0 ? (
                              <div className="info-item">
                                <div className="info-item-label">Нет привязанных студентов</div>
                              </div>
                            ) : (
                              <div className="stack" style={{ gap: 10 }}>
                                {d.students.map((s) => (
                                  <div key={s.id} className="info-item">
                                    <div>
                                      <div style={{ fontWeight: 600 }}>{s.full_name}</div>
                                      <div className="page-subtitle" style={{ marginTop: 4 }}>
                                        {getMatchSourceLabel(s.match_source)}
                                      </div>
                                    </div>

                                    {d.is_shared && (
                                      <button
                                        className="btn btn-danger"
                                        onClick={() => unlink(d.id, s.id)}
                                      >
                                        Отвязать
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="page-subtitle" style={{ marginTop: 16 }}>
                              ID документа: {d.id}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === "users" && (
        <>
          <div className="card section-card">
            <div className="page-header" style={{ marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>Создать пользователя</h3>
                <p className="page-subtitle" style={{ marginTop: 6 }}>
                  Назначение роли и групп для куратора
                </p>
              </div>
            </div>

            <div className="grid-3">
              <div>
                <label className="label">Логин</label>
                <input
                  className="input"
                  value={newLogin}
                  onChange={(e) => setNewLogin(e.target.value)}
                  placeholder="Введите логин"
                />
              </div>

              <div>
                <label className="label">Пароль</label>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Введите пароль"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowNewPassword((v) => !v)}
                  >
                    {showNewPassword ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              <div>
                <label className="label">Подтвердите пароль</label>
                <input
                  className="input"
                  type={showNewPassword ? "text" : "password"}
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  placeholder="Повторите пароль"
                />
              </div>

              <div>
                <label className="label">Роль</label>
                <select
                  className="select"
                  style={selectStyle}
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                >
                  <option value="teacher">teacher</option>
                  <option value="head">head</option>
                  <option value="manager">manager</option>
                  {me?.role === "admin" && <option value="admin">admin</option>}
                </select>
              </div>
            </div>

            {newRole === "teacher" && (
              <div style={{ marginTop: 16 }}>
                <label className="label">Группы куратора</label>

                {groups.length === 0 ? (
                  <div className="page-subtitle">Группы не найдены</div>
                ) : (
                  <div className="grid-3">
                    {groups.map((g) => (
                      <label
                        key={g.id}
                        className="info-item"
                        style={{ cursor: "pointer", alignItems: "center" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={selectedGroups.includes(g.id)}
                            onChange={(e) => toggleNewGroup(g.id, e.target.checked)}
                          />
                          <span>{g.name}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {newRole === "head" && (
              <div style={{ marginTop: 16 }}>
                <label className="label">Отделения заведующего</label>

                {departments.length === 0 ? (
                  <div className="page-subtitle">Отделения не найдены</div>
                ) : (
                  <div className="grid-3">
                    {departments.map((d) => (
                      <label
                        key={d.id}
                        className="info-item"
                        style={{ cursor: "pointer", alignItems: "center" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={selectedDepartments.includes(d.id)}
                            onChange={(e) => toggleNewDepartment(d.id, e.target.checked)}
                          />
                          <span>{d.name}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <button
                className="btn btn-primary"
                onClick={createUser}
                disabled={creatingUser}
              >
                {creatingUser ? "Создание..." : "Создать пользователя"}
              </button>
            </div>
          </div>

          <div className="card section-card">
            <div className="page-header" style={{ marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>Список пользователей</h3>
                <p className="page-subtitle" style={{ marginTop: 6 }}>
                  Управление ролями, паролями и назначенными группами
                </p>
              </div>
            </div>

            {usersLoading ? (
              <div className="page-subtitle">Загрузка пользователей...</div>
            ) : users.length === 0 ? (
              <div className="card empty-state">
                <div className="empty-state-icon">👤</div>
                <h3>Пользователей нет</h3>
                <p>Создай первого пользователя через форму выше.</p>
              </div>
            ) : (
              <div className="stack" style={{ gap: 12 }}>
                {users.map((u) => (
                  <div key={u.id} className="card section-card">
                    <div className="info-item">
                      <div>
                        <div style={{ fontWeight: 700 }}>{u.login}</div>
                        <div className="page-subtitle" style={{ marginTop: 4 }}>
                          Роль: {u.role}
                        </div>

                        {u.created_at && (
                          <div className="page-subtitle" style={{ marginTop: 4 }}>
                            Создан: {formatDate(u.created_at)}
                          </div>
                        )}

                        {u.groups && u.groups.length > 0 && (
                          <div className="row" style={{ marginTop: 10 }}>
                            {u.groups.map((g) => (
                              <span key={g.id} className="badge badge-info">
                                {g.name}
                              </span>
                            ))}
                          </div>
                        )}

                        {u.departments && u.departments.length > 0 && (
                          <div className="row" style={{ marginTop: 10 }}>
                            {u.departments.map((d) => (
                              <span key={d.id} className="badge badge-purple">
                                {d.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="row">
                        {!(me?.role === "manager" && u.role === "admin") && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => startEdit(u)}
                          >
                            Редактировать
                          </button>
                        )}

                        {me?.role === "admin" && (
                          <button
                            className="btn btn-danger"
                            onClick={() => deleteUser(u.id, u.login)}
                          >
                            Удалить
                          </button>
                        )}
                      </div>
                    </div>

                    {editingUserId === u.id && (
                      <div style={{ marginTop: 18 }}>
                        <div className="grid-3">
                          <div>
                            <label className="label">Логин</label>
                            <input
                              className="input"
                              value={editLogin}
                              onChange={(e) => setEditLogin(e.target.value)}
                              placeholder="Введите логин"
                            />
                          </div>

                          <div>
                            <label className="label">Новая роль</label>
                            <select
                              className="select"
                              style={selectStyle}
                              value={editRole}
                              onChange={(e) => setEditRole(e.target.value as UserRole)}
                            >
                              <option value="teacher">teacher</option>
                              <option value="head">head</option>
                              <option value="manager">manager</option>
                              {me?.role === "admin" && <option value="admin">admin</option>}
                            </select>
                          </div>

                          {me?.role === "admin" && (
                            <div>
                              <label className="label">Новый пароль</label>
                              <div className="row" style={{ gap: 8 }}>
                                <input
                                  className="input"
                                  type={showEditPassword ? "text" : "password"}
                                  value={editPassword}
                                  onChange={(e) => setEditPassword(e.target.value)}
                                  placeholder="Оставь пустым, если не менять"
                                />
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => setShowEditPassword((v) => !v)}
                                >
                                  {showEditPassword ? "🙈" : "👁"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {me?.role === "admin" && (
                          <div style={{ marginTop: 16 }}>
                            <label className="label">Подтвердите новый пароль</label>
                            <input
                              className="input"
                              type={showEditPassword ? "text" : "password"}
                              value={editPasswordConfirm}
                              onChange={(e) => setEditPasswordConfirm(e.target.value)}
                              placeholder="Повторите новый пароль"
                            />
                          </div>
                        )}

                        {editRole === "teacher" && (
                          <div style={{ marginTop: 16 }}>
                            <label className="label">Группы teacher</label>

                            {groups.length === 0 ? (
                              <div className="page-subtitle">Группы не найдены</div>
                            ) : (
                              <div className="grid-3">
                                {groups.map((g) => (
                                  <label
                                    key={g.id}
                                    className="info-item"
                                    style={{ cursor: "pointer", alignItems: "center" }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={editGroups.includes(g.id)}
                                        onChange={(e) =>
                                          toggleEditGroup(g.id, e.target.checked)
                                        }
                                      />
                                      <span>{g.name}</span>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {editRole === "head" && (
                          <div style={{ marginTop: 16 }}>
                            <label className="label">Отделения head</label>

                            {departments.length === 0 ? (
                              <div className="page-subtitle">Отделения не найдены</div>
                            ) : (
                              <div className="grid-3">
                                {departments.map((d) => (
                                  <label
                                    key={d.id}
                                    className="info-item"
                                    style={{ cursor: "pointer", alignItems: "center" }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={editDepartments.includes(d.id)}
                                        onChange={(e) =>
                                          toggleEditDepartment(d.id, e.target.checked)
                                        }
                                      />
                                      <span>{d.name}</span>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="row" style={{ marginTop: 18 }}>
                          <button
                            className="btn btn-primary"
                            onClick={() => saveUser(u.id)}
                            disabled={savingUserId === u.id}
                          >
                            {savingUserId === u.id ? "Сохранение..." : "Сохранить"}
                          </button>

                          <button
                            className="btn btn-secondary"
                            onClick={cancelEdit}
                            disabled={savingUserId === u.id}
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "departments" && (
        <>
          <div className="card section-card">
            <div className="page-header" style={{ marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>Создать отделение</h3>
                <p className="page-subtitle" style={{ marginTop: 6 }}>
                  Отделение объединяет группы, студентов и документы
                </p>
              </div>
            </div>

            <div className="grid-3">
              <div>
                <label className="label">Название отделения</label>
                <input
                  className="input"
                  value={newDepartmentName}
                  onChange={(e) => setNewDepartmentName(e.target.value)}
                  placeholder="Например: Отделение информационных систем"
                />
              </div>

              <div>
                <label className="label">Описание</label>
                <input
                  className="input"
                  value={newDepartmentDesc}
                  onChange={(e) => setNewDepartmentDesc(e.target.value)}
                  placeholder="Необязательно"
                />
              </div>

              <div>
                <label className="label">Действие</label>
                <button
                  className="btn btn-primary"
                  onClick={createDepartment}
                  disabled={creatingDepartment}
                >
                  {creatingDepartment ? "Создание..." : "Создать отделение"}
                </button>
              </div>
            </div>
          </div>

          <div className="card section-card">
            <div className="page-header" style={{ marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>Список отделений</h3>
                <p className="page-subtitle" style={{ marginTop: 6 }}>
                  Эти отделения можно назначать пользователям с ролью head
                </p>
              </div>

              <button className="btn btn-secondary" onClick={loadDepartments}>
                Обновить
              </button>
            </div>

            {departments.length === 0 ? (
              <div className="card empty-state">
                <div className="empty-state-icon">🏫</div>
                <h3>Отделений пока нет</h3>
                <p>Создай первое отделение через форму выше.</p>
              </div>
            ) : (
              <div className="stack" style={{ gap: 12 }}>
                {departments.map((d) => (
                  <div key={d.id} className="info-item">
                    <div>
                      <div style={{ fontWeight: 700 }}>{d.name}</div>
                      <div className="page-subtitle" style={{ marginTop: 4 }}>
                        {d.description || "Описание не указано"}
                      </div>

                      {d.created_at && (
                        <div className="page-subtitle" style={{ marginTop: 4 }}>
                          Создано: {formatDate(d.created_at)}
                        </div>
                      )}
                    </div>

                    {me?.role === "admin" && (
                      <button
                        className="btn btn-danger"
                        onClick={() => deleteDepartment(d.id, d.name)}
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
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