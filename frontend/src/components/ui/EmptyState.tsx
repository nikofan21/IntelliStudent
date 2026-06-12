import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  icon?: ReactNode;
};

export default function EmptyState({ title, description, icon }: Props) {
  return (
    <div className="card empty-state">
      <div className="empty-state-icon">{icon || <span>📭</span>}</div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
    </div>
  );
}