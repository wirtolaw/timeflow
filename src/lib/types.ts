export interface Category {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
}

export interface TimeEntry {
  id: string;
  user_id: string;
  category_id: string;
  project_id: string | null;
  start_time: string;
  end_time: string | null;
  is_primary: boolean;
  device_id: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  category_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
}
