export interface AssignmentRecord {
  id: string;
  hscode: string;
  description: string;
  datasetVersion: string;
  documentHash: string;
  confidence: number;
  assignedAt: string;
  status: "draft_assigned";
}
