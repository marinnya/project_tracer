export type ProjectStatus = "В работе" | "Завершен";

export interface Project {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  responsible: string;
  status: ProjectStatus;
}