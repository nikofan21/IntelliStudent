import type { ReactNode } from "react";

type StatCardProps = {
  title: string;
  value: string | number;
  icon?: ReactNode;
  subtitle?: string;
};

export default function StatCard({
  title,
  value,
  icon,
  subtitle,
}: StatCardProps) {
  return (
    <div className="card stat-card">
      <div className="stat-card-top">
        <div>
          <div className="stat-card-title">{title}</div>
          <div className="stat-card-value">{value}</div>
        </div>

        <div className="stat-card-icon">{icon || <span>📊</span>}</div>
      </div>

      {subtitle ? <div className="stat-card-subtitle">{subtitle}</div> : null}
    </div>
  );
}