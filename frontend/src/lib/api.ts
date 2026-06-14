import axios from "axios";
import { getToken } from "./auth";

/* ===================== */
/* AXIOS INSTANCE */
/* ===================== */

export const api = axios.create({
  baseURL: "/api",
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/* ===================== */
/* TYPES */
/* ===================== */

export interface Group {
  department_id?: number | null;
  department_name?: string | null;
  id: number;
  prefix: string;
  admission_year: number;
  course: number;
  suffix: string;
  name: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
}

export interface Student {
  id: number;
  full_name: string;
  group_id: number;
  group_name?: string;
  course?: number;
  email: string;
  created_at: string;
}

/* ===================== */
/* GROUPS API */
/* ===================== */

export const getGroups = async (): Promise<Group[]> => {
  const res = await api.get("/groups/");
  return res.data;
};

export const createGroup = async (data: {
  prefix: string;
  admission_year: number;
  course: number;
  suffix: string;
  is_active?: boolean;
}) => {
  const res = await api.post("/groups/", data);
  return res.data;
};

export const updateGroup = async (
  id: number,
  data: {
    prefix: string;
    admission_year: number;
    course: number;
    suffix: string;
    is_active?: boolean;
  }
) => {
  const res = await api.put(`/groups/${id}`, data);
  return res.data;
};

export const promoteGroups = async (group_ids: number[]) => {
  const res = await api.post("/groups/promote", { group_ids });
  return res.data;
};

/* ===================== */
/* STUDENTS API */
/* ===================== */

export const getStudents = async (group_id?: number): Promise<Student[]> => {
  const res = await api.get("/students/", {
    params: group_id ? { group_id } : {},
  });
  return res.data;
};

export const createStudent = async (data: {
  full_name: string;
  group_id: number;
  email: string;
}) => {
  const res = await api.post("/students/", data);
  return res.data;
};

export const updateStudent = async (
  id: number,
  data: {
    full_name: string;
    group_id: number;
    email: string;
  }
) => {
  const res = await api.put(`/students/${id}`, data);
  return res.data;
};

export const deleteStudent = async (id: number) => {
  const res = await api.delete(`/students/${id}`);
  return res.data;
};

/* ===================== */
/* SEARCH */
/* ===================== */

export const searchStudents = async (
  group_id: number,
  q: string
) => {
  const res = await api.get("/search/student", {
    params: { group_id, q },
  });
  return res.data;
};

/* ===================== */
/* DOCUMENTS (основное) */
/* ===================== */

export const getUnassignedDocuments = async () => {
  const res = await api.get("/documents/unassigned");
  return res.data;
};

export const uploadDocument = async (formData: FormData) => {
  const res = await api.post("/documents/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return res.data;
};

export const assignDocument = async (doc_id: number, student_id: number) => {
  const res = await api.post(`/documents/${doc_id}/assign`, null, {
    params: { student_id },
  });
  return res.data;
};

export const assignDocumentMany = async (doc_id: number, student_ids: number[]) => {
  const res = await api.post(`/documents/${doc_id}/assign-many`, {
    student_ids,
  });
  return res.data;
};

export const assignDocumentToGroup = async (doc_id: number, group_id: number) => {
  const res = await api.post(`/documents/${doc_id}/assign-group/${group_id}`);
  return res.data;
};

export const deleteDocument = async (doc_id: number) => {
  const res = await api.delete(`/documents/${doc_id}`);
  return res.data;
};

export const downloadDocumentUrl = (doc_id: number) =>
  `/api/documents/download/${doc_id}`;