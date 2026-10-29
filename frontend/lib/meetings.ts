import { api } from "@/lib/auth";

export interface Meeting {
  code: string;
  status: "active" | "ended";
  host_name: string;
  is_host: boolean;
  created_at: string;
}

export const createMeeting = () => api<Meeting>("/api/meetings", { method: "POST" });

export const getMeeting = (code: string) => api<Meeting>(`/api/meetings/${encodeURIComponent(code)}`);

export const endMeeting = (code: string) =>
  api<Meeting>(`/api/meetings/${encodeURIComponent(code)}/end`, { method: "POST" });

export const listMeetings = () => api<Meeting[]>("/api/meetings");
