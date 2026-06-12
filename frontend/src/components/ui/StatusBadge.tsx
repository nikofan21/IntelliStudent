type StatusType =
  | "processed"
  | "unassigned"
  | "personal"
  | "shared"
  | "pdf"
  | "docx"
  | "txt"
  | "admin"
  | "teacher"
  | string;

type Props = {
  status: StatusType;
  text?: string;
};

export default function StatusBadge({ status, text }: Props) {
  const normalized = String(status).toLowerCase();

  let className = "badge badge-default";

  if (normalized === "processed") className = "badge badge-success";
  else if (normalized === "unassigned") className = "badge badge-warning";
  else if (normalized === "personal") className = "badge badge-info";
  else if (normalized === "shared") className = "badge badge-purple";
  else if (normalized === "pdf") className = "badge badge-danger";
  else if (normalized === "docx") className = "badge badge-primary";
  else if (normalized === "txt") className = "badge badge-gray";
  else if (normalized === "admin") className = "badge badge-danger";
  else if (normalized === "teacher") className = "badge badge-info";

  return <span className={className}>{text || status}</span>;
}