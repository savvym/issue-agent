import { z } from 'zod';

export const issueUnderstandingSchema = z.object({
  issueType: z.enum(['bug', 'feature', 'refactor', 'documentation', 'question', 'other']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  summary: z.string(),
  keySymptoms: z.array(z.string()).min(1),
  acceptanceSignals: z.array(z.string()).min(1),
  searchKeywords: z.array(z.string()).min(3).max(12),
});

export const evidenceItemSchema = z.object({
  filePath: z.string(),
  rationale: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
  excerpt: z.string().optional(),
});

export const codeInvestigationSchema = z.object({
  hypotheses: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      confidence: z.enum(['low', 'medium', 'high']),
      evidence: z.array(evidenceItemSchema).min(1),
      impactedPaths: z.array(z.string()).min(1),
    }),
  ).min(1),
  missingEvidence: z.array(z.string()),
  additionalFilesToInspect: z.array(z.string()),
});

export const executionPlanSchema = z.object({
  complexity: z.enum(['S', 'M', 'L', 'XL']),
  estimatedEffort: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  risks: z.array(z.string()),
  unknowns: z.array(z.string()),
  implementationSteps: z.array(
    z.object({
      step: z.string(),
      detail: z.string(),
      verification: z.string(),
    }),
  ).min(3),
  testPlan: z.array(z.string()).min(3),
});

export const issueReportSchema = z.object({
  title: z.string(),
  repository: z.string(),
  issueNumber: z.number().int().positive(),
  issueUrl: z.string(),
  generatedAt: z.string(),
  classification: z.object({
    type: z.string(),
    severity: z.string(),
    complexity: z.string(),
    riskLevel: z.string(),
  }),
  executiveSummary: z.string(),
  rootCauseHypotheses: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      confidence: z.string(),
      impactedPaths: z.array(z.string()),
    }),
  ),
  evidence: z.array(evidenceItemSchema),
  implementationPlan: z.array(
    z.object({
      order: z.number().int().positive(),
      step: z.string(),
      detail: z.string(),
      verification: z.string(),
    }),
  ),
  testingChecklist: z.array(z.string()),
  openQuestions: z.array(z.string()),
  artifacts: z.object({
    issueSnapshotPath: z.string(),
    reportJsonPath: z.string(),
    reportMarkdownPath: z.string(),
  }),
});

export type IssueUnderstanding = z.infer<typeof issueUnderstandingSchema>;
export type CodeInvestigation = z.infer<typeof codeInvestigationSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
export type IssueReport = z.infer<typeof issueReportSchema>;
